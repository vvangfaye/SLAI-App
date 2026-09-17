const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CookieJar, LoginProbe, resolve, transportUrl } = require('../miniprogram/services/login-probe');
test('三个学校逻辑域映射到单一代理且保留路径与查询串', () => {
  assert.equal(transportUrl('https://sis.slai.edu.cn/yjsxt/htxylogin?a=1%2B2'), 'https://openslai.cn/_slai/sis/yjsxt/htxylogin?a=1%2B2');
  assert.equal(transportUrl('https://sts.slai.edu.cn/adfs/'), 'https://openslai.cn/_slai/sts/adfs/');
  assert.equal(transportUrl('https://stu.slai.edu.cn/'), 'https://openslai.cn/_slai/stu/');
  assert.equal(resolve('https://sis.slai.edu.cn/start', 'https://openslai.cn/_slai/sts/adfs/login?state=a%2Bb'), 'https://sts.slai.edu.cn/adfs/login?state=a%2Bb');
  assert.throws(() => transportUrl('https://example.com/'));
  assert.throws(() => resolve('https://sis.slai.edu.cn/', '//sts.slai.edu.cn/'));
});
test('请求仅发送到代理并以学校逻辑地址处理重定向', async () => {
  const calls = [];
  const replies = [
    { statusCode: 302, header: { Location: 'https://sts.slai.edu.cn/adfs/login?state=a%2Bb' } },
    { statusCode: 302, header: { Location: '/adfs/next?code=1%2F2' } },
    { statusCode: 200, header: {}, data: 'ok' }
  ];
  const probe = new LoginProbe(async options => { calls.push(options); return replies.shift(); });
  const result = await probe.request('https://sis.slai.edu.cn/yjsxt/htxylogin');
  assert.deepEqual(calls.map(call => call.url), [
    'https://openslai.cn/_slai/sis/yjsxt/htxylogin',
    'https://openslai.cn/_slai/sts/adfs/login?state=a%2Bb',
    'https://openslai.cn/_slai/sts/adfs/next?code=1%2F2'
  ]);
  assert.equal(result.url, 'https://sts.slai.edu.cn/adfs/next?code=1%2F2');
});
test('模拟器自动跟随后明确提示客户端限制且不提交密码', async () => {
  const calls = [];
  const probe = new LoginProbe(async options => {
    calls.push(options);
    return { statusCode: 200, header: {}, data: '<form id="loginForm" action="/adfs/oauth2/authorize"></form>FormsAuthentication' };
  });
  await assert.rejects(probe.authenticate('https://sis.slai.edu.cn/yjsxt/htxylogin', 'example@slai.edu.cn', 'test-only'), /密码尚未提交/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].data, '');
});
test('认证 Cookie 限定域名、路径与有效期', () => {
  const jar = new CookieJar();
  jar.receive('https://sts.slai.edu.cn/adfs/login', ['auth=secret; Path=/adfs; Max-Age=60', 'shared=ok; Domain=.slai.edu.cn; Path=/'], 1000);
  assert.match(jar.forUrl('https://sts.slai.edu.cn/adfs/oauth2', 2000), /auth=secret/);
  assert.equal(jar.forUrl('https://sis.slai.edu.cn/', 2000), 'shared=ok');
  assert.equal(jar.forUrl('https://sts.slai.edu.cn/adfs-other', 2000), 'shared=ok');
  assert.equal(jar.forUrl('https://sts.slai.edu.cn/adfs/login', 62000), 'shared=ok');
  jar.receive('https://sts.slai.edu.cn/', ['shared=; Domain=.slai.edu.cn; Path=/; Max-Age=0'], 3000);
  assert.equal(jar.forUrl('https://sis.slai.edu.cn/', 4000), '');
  jar.clear(); assert.equal(jar.rows.length, 0);
});
test('拒绝非学校地址和伪造 cookie 域', () => {
  assert.throws(() => resolve('https://sis.slai.edu.cn/', 'https://example.com/'));
  assert.throws(() => resolve('https://sis.slai.edu.cn/', '//example.com/'));
  const jar = new CookieJar(); jar.receive('https://sts.slai.edu.cn/', ['a=b; Domain=edu.cn', 'a=b; Domain=sis.slai.edu.cn']);
  assert.equal(jar.rows.length, 0);
});
test('表单 POST 经 302 变成 GET，不把密码转发给教务系统', async () => {
  const calls = [];
  const probe = new LoginProbe(async options => {
    calls.push(options);
    return calls.length === 1 ? { statusCode: 302, header: { Location: 'https://sis.slai.edu.cn/yjsxt/htxylogin', 'Set-Cookie': 'adfs=x; Path=/' } } : { statusCode: 200, header: {}, data: '' };
  });
  await probe.request('https://sts.slai.edu.cn/adfs/login', 'POST', 'Password=test');
  assert.equal(calls[1].method, 'GET'); assert.equal(calls[1].data, ''); assert.equal(calls[1].header.Cookie, '');
});
test('307 跨域携带密码的跳转被阻止', async () => {
  const probe = new LoginProbe(async () => ({ statusCode: 307, header: { Location: 'https://sis.slai.edu.cn/' } }));
  await assert.rejects(probe.request('https://sts.slai.edu.cn/', 'POST', 'Password=test'), /跨域 POST/);
});
test('308 同域保留 POST，303 随后切换为 GET', async () => {
  const calls = [];
  const replies = [
    { statusCode: 308, header: { Location: '/adfs/next' } },
    { statusCode: 303, header: { Location: '?done=1' } },
    { statusCode: 200, header: {}, data: '' }
  ];
  const probe = new LoginProbe(async options => { calls.push(options); return replies.shift(); });
  await probe.request('https://sts.slai.edu.cn/adfs/login', 'POST', 'Password=test');
  assert.deepEqual(calls.map(call => [call.method, call.data]), [['POST', 'Password=test'], ['POST', 'Password=test'], ['GET', '']]);
});
test('业务 JSON 形状验证后才报告通过，凭据不会写入日志', async () => {
  const replies = [
    { statusCode: 302, header: { Location: 'https://sts.slai.edu.cn/adfs/oauth2/authorize' } },
    { statusCode: 200, data: '<form id="loginForm" action="/adfs/oauth2/authorize"></form>FormsAuthentication' },
    { statusCode: 302, header: { Location: 'https://sis.slai.edu.cn/yjsxt/htxylogin' } },
    { statusCode: 200, data: 'home' },
    { statusCode: 200, data: '{"year":"2026-2027","semester":"1"}' },
    { statusCode: 200, data: '{"kbList":[]}' },
    { statusCode: 200, data: 'home' },
    { statusCode: 200, data: '{"code":0,"data":[]}' }
  ];
  const logs = [];
  const probe = new LoginProbe(async () => ({ header: {}, ...replies.shift() }));
  await probe.verify('demo@example.invalid', 'secret-value', m => logs.push(m));
  assert.match(logs.at(-1), /验证通过/); assert.ok(!logs.join('').includes('secret-value')); assert.equal(replies.length, 0);
});
