const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const zlib = require('node:zlib');
const { createRelayServer, gatewayRequest } = require('../server/relay');
const { LoginProbe, wxTransport } = require('../miniprogram/services/login-probe');
const { PROTOCOL, RELAY_URL, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES } = require('../miniprogram/services/relay-protocol');

function school(replies, calls = []) {
  return (options, callback) => {
    const request = new EventEmitter();
    request.destroy = error => { if (error) queueMicrotask(() => request.emit('error', error)); };
    request.end = data => {
      calls.push({ ...options, data });
      queueMicrotask(() => {
        const reply = replies.shift();
        if (reply instanceof Error) { request.emit('error', reply); return; }
        if (!reply) { request.emit('error', new Error('No fixture')); return; }
        const response = Readable.from([Buffer.from(reply.data || '')]);
        response.statusCode = reply.statusCode;
        response.headers = reply.header || {};
        callback(response);
      });
    };
    return request;
  };
}
async function start(t, options) {
  const server = createRelayServer(options);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return server.address().port;
}
function post(port, payload, { path = '/_slai/relay', method = 'POST', contentType = 'application/json' } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path, method, headers: { 'Content-Type': contentType } }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode, header: response.headers, data }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  });
}
function payload(url = 'https://sis.slai.edu.cn/start') {
  return { protocol: PROTOCOL, url, method: 'GET', header: {}, data: '' };
}
const wxOriginals = new WeakMap();
function useWx(t, handler) {
  if (!wxOriginals.has(t)) {
    const previous = global.wx;
    wxOriginals.set(t, previous);
    t.after(() => { global.wx = previous; wxOriginals.delete(t); });
  }
  global.wx = { request: handler };
}
test('学校 302 和独立 Cookie 被封装成 200，无外层跳转或 Cookie', async t => {
  const calls = [];
  const cookies = ['sis=fixture; Path=/; Expires=Wed, 01 Jan 2031 00:00:00 GMT', 'other=fixture; Path=/'];
  const port = await start(t, { request: school([{ statusCode: 302, header: { location: 'https://sts.slai.edu.cn/adfs/login?state=a%2Bb', 'set-cookie': cookies, refresh: '0;url=https://sts.slai.edu.cn/', 'x-accel-redirect': '/elsewhere' } }], calls) });
  const request = payload('https://sis.slai.edu.cn/start?state=a%252Bb&return=%2F..%2F');
  request.header = { Cookie: 'only=this-user', Host: 'other.invalid', Authorization: 'ignored', 'Accept-Encoding': 'gzip' };
  const response = await post(port, request);
  assert.equal(response.statusCode, 200);
  assert.equal(response.header.location, undefined);
  assert.equal(response.header['set-cookie'], undefined);
  assert.equal(response.header.refresh, undefined);
  assert.equal(response.header['cache-control'], 'no-store');
  const envelope = JSON.parse(response.data);
  assert.equal(envelope.statusCode, 302);
  assert.deepEqual(envelope.header['set-cookie'], cookies);
  assert.equal(envelope.header['x-accel-redirect'], undefined);
  assert.equal(calls.length, 1); // No upstream redirect following.
  assert.equal(calls[0].hostname, 'sis.slai.edu.cn');
  assert.equal(calls[0].path, '/start?state=a%252Bb&return=%2F..%2F');
  assert.equal(calls[0].rejectUnauthorized, true);
  assert.equal(calls[0].servername, 'sis.slai.edu.cn');
  assert.equal(calls[0].headers.host, undefined);
  assert.equal(calls[0].headers.authorization, undefined);
  assert.equal(calls[0].headers.cookie, 'only=this-user');
  assert.equal(calls[0].headers['accept-encoding'], 'identity');
});
test('小程序默认传输通过实际 HTTP 中转完成多次登录跳转，按学校域隔离 Cookie', async t => {
  const calls = [], nativeCalls = [];
  const port = await start(t, { request: school([
    { statusCode: 302, header: { location: 'https://sts.slai.edu.cn/adfs/login', 'set-cookie': ['sis=fixture-sis; Path=/'] } },
    { statusCode: 200, header: { 'set-cookie': ['adfs=fixture-sts; Path=/'], 'content-type': 'text/html' }, data: '<form id="loginForm" action="/adfs/login"></form>FormsAuthentication' },
    { statusCode: 302, header: { location: '/adfs/next', 'set-cookie': ['adfs=new-fixture; Path=/'] } },
    { statusCode: 303, header: { location: '/_slai/sis/callback?code=fixture' } },
    { statusCode: 200, data: 'home' }
  ], calls) });
  useWx(t, options => {
    nativeCalls.push(options);
    assert.equal(options.url, RELAY_URL);
    assert.equal(options.method, 'POST');
    assert.equal(options.header.Cookie, undefined);
    // A native client that follows HTTP redirects never sees one here.
    post(port, options.data).then(response => {
      assert.equal(response.statusCode, 200);
      assert.equal(response.header.location, undefined);
      assert.equal(response.header['set-cookie'], undefined);
      options.success(response);
    }, options.fail);
    return {}; // No onHeadersReceived support needed.
  });
  const probe = new LoginProbe();
  await probe.authenticate('https://sis.slai.edu.cn/start', 'fixture@example.invalid', 'test-only');
  assert.equal(nativeCalls.length, 5);
  assert.deepEqual(calls.map(call => [call.hostname, call.method, call.headers.cookie]), [
    ['sis.slai.edu.cn', 'GET', ''], ['sts.slai.edu.cn', 'GET', ''],
    ['sts.slai.edu.cn', 'POST', 'adfs=fixture-sts'], ['sts.slai.edu.cn', 'GET', 'adfs=new-fixture'],
    ['sis.slai.edu.cn', 'GET', 'sis=fixture-sis']
  ]);
  assert.match(calls[2].data, /Password=test-only/);
  assert.ok(calls.filter((_, i) => i !== 2).every(call => call.data === ''));
  probe.close();
  assert.equal(probe.jar.rows.length, 0);
});
test('中转数据中的跨域 307/308 仍在下一次请求前阻止密码转发', async t => {
  for (const statusCode of [307, 308]) {
    const calls = [];
    useWx(t, options => {
      calls.push(options);
      options.success({ statusCode: 200, data: JSON.stringify({ protocol: PROTOCOL, statusCode, header: { location: 'https://sis.slai.edu.cn/callback' }, data: '' }) });
      return {};
    });
    const probe = new LoginProbe();
    await assert.rejects(probe.request('https://sts.slai.edu.cn/adfs/login', 'POST', 'Password=test-only'), /跨域 POST/);
    assert.equal(calls.length, 1);
  }
});
test('旧接口及损坏中转响应停止认证，且不回退到原来的跳转通道', async t => {
  for (const response of [
    { statusCode: 404, data: '<html>not found</html>' },
    { statusCode: 200, data: '<form id="loginForm"></form>FormsAuthentication' },
    { statusCode: 302, header: { location: 'https://sts.slai.edu.cn/' }, data: '' },
    { statusCode: 200, data: JSON.stringify({ protocol: PROTOCOL, statusCode: '302', header: {}, data: '' }) },
    { statusCode: 200, data: JSON.stringify({ protocol: PROTOCOL, statusCode: 302, header: { location: ['https://sts.slai.edu.cn/'] }, data: '' }) },
    { statusCode: 200, data: JSON.stringify({ protocol: PROTOCOL, statusCode: 200, header: {}, data: { arbitrary: true } }) }
  ]) {
    const calls = [];
    useWx(t, options => { calls.push(options); options.success(response); return {}; });
    await assert.rejects(new LoginProbe().authenticate('https://sis.slai.edu.cn/start', 'fixture@example.invalid', 'test-only'), /中转|代理登录接口/);
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(calls[0].data).data, '');
  }
});
test('服务端拒绝其他域、危险路径、异常方法与头注入，上游不会收到请求', async t => {
  const calls = [];
  const port = await start(t, { request: school([], calls) });
  const invalid = [
    payload('https://other.invalid/'), payload('http://sts.slai.edu.cn/'), payload('https://sts.slai.edu.cn:444/'),
    ...['/../sis/callback', '/%2e%2e/sis/callback', '/%252e%252e/sis/callback', '/a%2fb', '/a%255cb'].map(path => payload('https://sts.slai.edu.cn' + path)),
    { ...payload(), method: 'DELETE' }, { ...payload(), protocol: 'unknown' },
    { ...payload(), data: 'body-in-get' }, { ...payload(), header: { Cookie: 'x=y\r\nHost: other.invalid' } },
    '{invalid json'
  ];
  for (const value of invalid) {
    const response = await post(port, value);
    assert.equal(response.statusCode, 400);
    assert.equal(JSON.parse(response.data).error.code, 'BAD_REQUEST');
  }
  assert.equal((await post(port, payload(), { contentType: 'text/plain' })).statusCode, 400);
  assert.equal((await post(port, '', { method: 'GET' })).statusCode, 400);
  assert.equal((await post(port, payload(), { path: '/_slai/sis/start' })).statusCode, 404);
  assert.equal(calls.length, 0);
});
test('上游证书错误有独立提示，不泄露底层错误或关闭 TLS 校验', async t => {
  const calls = [];
  const error = new Error('sensitive upstream details'); error.code = 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';
  const port = await start(t, { request: school([error], calls) });
  const response = await post(port, payload());
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.data).error.code, 'UPSTREAM_TLS_ERROR');
  assert.ok(!response.data.includes(error.message));
  useWx(t, options => { options.success(response); return {}; });
  await assert.rejects(wxTransport({ url: 'https://sis.slai.edu.cn/start', method: 'GET', header: {}, data: '' }), error => error.code === 'UPSTREAM_TLS_ERROR');
  assert.equal(calls[0].rejectUnauthorized, true);
});
test('上游总超时返回固定错误，客户端断开会取消学校请求', async t => {
  const requests = [];
  const request = options => {
    const upstream = new EventEmitter();
    upstream.end = () => {};
    upstream.destroy = error => { if (error) queueMicrotask(() => upstream.emit('error', error)); };
    requests.push(options);
    return upstream;
  };
  const port = await start(t, { request, timeoutMs: 30 });
  const response = await post(port, payload());
  assert.equal(JSON.parse(response.data).error.code, 'UPSTREAM_TIMEOUT');
  const aborted = new Promise(resolve => {
    const client = http.request({ hostname: '127.0.0.1', port, path: '/_slai/relay', method: 'POST', headers: { 'Content-Type': 'application/json' } });
    client.on('error', () => {});
    client.end(JSON.stringify(payload()));
    const poll = setInterval(() => { if (requests.length === 2) { clearInterval(poll); client.destroy(); resolve(requests[1].signal); } }, 2);
  });
  const signal = await aborted;
  if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
  assert.equal(signal.aborted, true);
});
test('压缩学校响应还原为文本，超大响应停止且不输出原始数据', async t => {
  const port = await start(t, { request: school([
    { statusCode: 200, header: { 'content-encoding': 'gzip', 'content-type': 'application/json' }, data: zlib.gzipSync(Buffer.from('{"kbList":[]}')) },
    { statusCode: 200, header: { 'content-encoding': 'gzip' }, data: zlib.gzipSync(Buffer.alloc(MAX_RESPONSE_BYTES + 1, 'a')) }
  ]) });
  assert.equal(JSON.parse((await post(port, payload())).data).data, '{"kbList":[]}');
  const oversized = await post(port, payload());
  assert.equal(JSON.parse(oversized.data).error.code, 'RESPONSE_TOO_LARGE');
});
test('超大请求在学校请求前被阻止', async t => {
  const calls = [];
  const port = await start(t, { request: school([], calls) });
  // A declared content length allows the gateway to reject before reading.
  const response = await new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: '/_slai/relay', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': MAX_REQUEST_BYTES + 1 } }, res => {
      let data = ''; res.on('data', chunk => { data += chunk; }); res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
    request.on('error', reject); request.end('{}');
  });
  assert.equal(response.statusCode, 413);
  assert.equal(JSON.parse(response.data).error.code, 'REQUEST_TOO_LARGE');
  assert.equal(calls.length, 0);
});
test('云端中转复用本机 FRP，固定学校路由并逐次返回跳转', async t => {
  const received = [];
  const gateway = http.createServer((request, response) => {
    received.push({ path: request.url, cookie: request.headers.cookie, host: request.headers.host });
    response.writeHead(302, { Location: 'https://sts.slai.edu.cn/adfs/login', 'Set-Cookie': ['sis=fixture; Path=/'] });
    response.end('');
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { gateway.close(resolve); gateway.closeAllConnections(); }));
  const port = await start(t, { request: gatewayRequest(`http://127.0.0.1:${gateway.address().port}`) });
  const request = payload('https://sis.slai.edu.cn/start?state=a%252Bb&return=%2F..%2F');
  request.header.Cookie = 'sis=this-user';
  const response = await post(port, request);
  assert.equal(response.statusCode, 200);
  assert.equal(response.header.location, undefined);
  assert.equal(JSON.parse(response.data).statusCode, 302);
  assert.deepEqual(received, [{ path: '/_slai/sis/start?state=a%252Bb&return=%2F..%2F', cookie: 'sis=this-user', host: 'openslai.cn' }]);
  for (const invalid of ['http://other.invalid:18080', 'http://127.0.0.1:0', 'http://127.0.0.1:70000', 'https://127.0.0.1:18080', 'http://127.0.0.1:18080/path']) assert.throws(() => gatewayRequest(invalid));
});
test('微信自动添加的 manual 查询参数不影响中转路由，也不传入学校 URL', async t => {
  const calls = [];
  const port = await start(t, { request: school([{ statusCode: 302, header: { location: 'https://sts.slai.edu.cn/adfs/login' } }], calls) });
  const response = await post(port, payload('https://sis.slai.edu.cn/start?state=a%2Bb'), { path: '/_slai/relay?_wx_redirect=manual' });
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.data).statusCode, 302);
  assert.equal(response.header.location, undefined);
  assert.equal(calls[0].path, '/start?state=a%2Bb');
  assert.equal(calls.length, 1);
});
