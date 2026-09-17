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
test('学校及代理 HTTPS 地址接受显式 443 端口，其他端口仍被拒绝', () => {
  const query = '?state=a%2Bb&client-request-id=test-only';
  for (const route of ['sis', 'sts', 'stu']) {
    const logical = `https://${route}.slai.edu.cn/adfs/login${query}`;
    for (const target of [`https://${route}.slai.edu.cn:443/adfs/login${query}`, `https://openslai.cn:443/_slai/${route}/adfs/login${query}`]) {
      assert.equal(resolve('https://sis.slai.edu.cn/start', target), logical);
      assert.equal(transportUrl(target), `https://openslai.cn/_slai/${route}/adfs/login${query}`);
    }
  }
  for (const authority of ['sts.slai.edu.cn:80', 'sts.slai.edu.cn:444', 'openslai.cn:8443', 'sts.slai.edu.cn:443@other.invalid']) {
    assert.throws(() => transportUrl(`https://${authority}/adfs/login`));
  }
  assert.throws(() => transportUrl('https://sts.slai.edu.cn:443/../sis/callback'), /路径/);
});
test('认证中携带显式 443 的同域回跳保持 Cookie，完成后正常读取教务', async () => {
  const calls = [];
  const replies = [
    { statusCode: 302, header: { Location: 'https://sts.slai.edu.cn/adfs/login' } },
    { statusCode: 200, header: {}, data: '<form id="loginForm" action="https://sts.slai.edu.cn:443/adfs/login"></form>FormsAuthentication' },
    { statusCode: 302, header: { Location: 'https://sts.slai.edu.cn:443/adfs/login?client-request-id=test-only', 'Set-Cookie': 'adfs=test-session; Path=/' } },
    { statusCode: 302, header: { Location: 'https://sis.slai.edu.cn:443/callback?code=test-only' } },
    { statusCode: 200, header: {}, data: 'ok' }
  ];
  const probe = new LoginProbe(async options => { calls.push(options); return replies.shift(); });
  await probe.authenticate('https://sis.slai.edu.cn/start', 'demo@example.invalid', 'test-only');
  assert.equal(calls[3].url, 'https://openslai.cn/_slai/sts/adfs/login?client-request-id=test-only');
  assert.equal(calls[3].header.Cookie, 'adfs=test-session');
  assert.equal(calls[3].method, 'GET');
  assert.equal(calls[3].data, '');
  assert.equal(calls[4].header.Cookie, '');
  assert.equal(replies.length, 0);
});
test('登录回跳返回 5xx 时报告服务异常，不将其归类为凭据失效', async () => {
  for (const host of ['sts', 'sis']) {
    for (const statusCode of [500, 502, 503]) {
      const replies = [
        { statusCode: 302, header: { Location: 'https://sts.slai.edu.cn/adfs/login' } },
        { statusCode: 200, header: {}, data: '<form id="loginForm" action="/adfs/login"></form>FormsAuthentication' },
        { statusCode: 302, header: { Location: `https://${host}.slai.edu.cn:443/callback` } },
        { statusCode, header: {}, data: 'Bad Gateway' }
      ];
      const probe = new LoginProbe(async () => replies.shift());
      await assert.rejects(probe.authenticate('https://sis.slai.edu.cn/start', 'demo@example.invalid', 'test-only'), error => {
        assert.equal(error.code, 'AUTH_SERVER_ERROR');
        assert.match(error.message, new RegExp(`HTTP ${statusCode}`));
        return true;
      });
    }
  }
});
const unsafePaths = [
  '/../sis/callback', '/./adfs/login', '/adfs/../../sis/callback', '/adfs//../sis/callback',
  '/%2e%2e/sis/callback', '/.%2E/sis/callback', '/%2E./sis/callback',
  '/%2e/adfs/login', '/adfs/%2E%2e/../sis/callback',
  '/%252e%252E/sis/callback', '/%25252e%25252e/sis/callback',
  '/..%2fsis/callback', '/%2F../sis/callback', '/..%252Fsis/callback',
  '/..\\sis/callback', '/..%5csis/callback', '/..%255csis/callback',
  '/.\t./sis/callback', '/.%0a./sis/callback', '/.%250d./sis/callback', '/..%20/sis/callback'
];
test('逻辑 URL 与代理 URL 均拒绝点段及编码分隔符，查询串保持原样', () => {
  for (const path of unsafePaths) {
    for (const root of ['https://sts.slai.edu.cn', 'https://openslai.cn/_slai/sts']) {
      assert.throws(() => transportUrl(root + path), /路径/, root + path);
      assert.throws(() => resolve('https://sts.slai.edu.cn/adfs/login', root + path), /路径/, root + path);
    }
    assert.throws(() => resolve('https://sts.slai.edu.cn/adfs/login', path), /路径/, path);
  }
  const path = '/adfs/v1.0/login%20name';
  const query = '?redirect=%2F..%2Fsis%2Fcallback&state=a%252Bb&value=../%2e%5c';
  assert.equal(transportUrl('https://sts.slai.edu.cn' + path + query), 'https://openslai.cn/_slai/sts' + path + query);
  assert.equal(resolve('https://sts.slai.edu.cn/adfs/login', query), 'https://sts.slai.edu.cn/adfs/login' + query);
});
test('初始请求路径不安全时不会调用传输层', async () => {
  const calls = [];
  const probe = new LoginProbe(async options => { calls.push(options); return { statusCode: 200, header: {} }; });
  for (const path of unsafePaths) {
    await assert.rejects(probe.request('https://sts.slai.edu.cn' + path, 'POST', 'Password=test'), /路径/);
  }
  assert.equal(calls.length, 0);
});
test('点段重定向在后续请求前停止，不转发原 Cookie 或 POST 数据', async () => {
  for (const statusCode of [302, 307, 308]) {
    for (const path of unsafePaths) {
      const calls = [];
      const probe = new LoginProbe(async options => {
        calls.push(options);
        return calls.length === 1 ? { statusCode, header: { Location: path } } : { statusCode: 200, header: {} };
      });
      probe.jar.receive('https://sts.slai.edu.cn/adfs/login', ['adfs=test-session; Path=/']);
      await assert.rejects(probe.request('https://sts.slai.edu.cn/adfs/login', 'POST', 'Password=test'), /路径/);
      assert.equal(calls.length, 1, `${statusCode}: ${path}`);
    }
  }
});
test('代理根相对跳转还原逻辑域，未知代理路由被拒绝', () => {
  for (const route of ['sis', 'sts', 'stu']) {
    const target = `/_slai/${route}/adfs/login?state=a%2Bb&return=%2F..%2F`;
    const logical = resolve('https://sis.slai.edu.cn/start', target);
    assert.equal(logical, `https://${route}.slai.edu.cn/adfs/login?state=a%2Bb&return=%2F..%2F`);
    assert.equal(transportUrl(logical), 'https://openslai.cn' + target);
    assert.equal(transportUrl(transportUrl(logical)), transportUrl(logical));
    assert.equal(resolve('https://sis.slai.edu.cn/start', `/_slai/${route}`), `https://${route}.slai.edu.cn/`);
  }
  for (const target of ['/_slai/other/login', '/_slai', '/_slai/', '/_slai/%73ts/login', '/_slai/sts/../sis/login', '/_slai/../sis/login', '/_slai/sts/%2e%2e/sis/login']) {
    assert.throws(() => resolve('https://sis.slai.edu.cn/start', target), undefined, target);
    assert.throws(() => transportUrl('https://openslai.cn' + target), undefined, target);
  }
});
test('代理相对跳转后的 Cookie 按目标学校归属，302 清除 POST 内容', async () => {
  const calls = [];
  const replies = [
    { statusCode: 302, header: { Location: '/_slai/sts/adfs/login' } },
    { statusCode: 302, header: { Location: '/_slai/sis/callback', 'Set-Cookie': 'adfs=new-session; Path=/' } },
    { statusCode: 200, header: {}, data: 'ok' }
  ];
  const probe = new LoginProbe(async options => { calls.push(options); return replies.shift(); });
  probe.jar.receive('https://sis.slai.edu.cn/', ['sis=test-sis; Path=/']);
  probe.jar.receive('https://sts.slai.edu.cn/', ['adfs=test-sts; Path=/']);
  const result = await probe.request('https://sis.slai.edu.cn/start', 'POST', 'Password=test');
  assert.deepEqual(calls.map(call => [call.url, call.method, call.data, call.header.Cookie]), [
    ['https://openslai.cn/_slai/sis/start', 'POST', 'Password=test', 'sis=test-sis'],
    ['https://openslai.cn/_slai/sts/adfs/login', 'GET', '', 'adfs=test-sts'],
    ['https://openslai.cn/_slai/sis/callback', 'GET', '', 'sis=test-sis']
  ]);
  assert.equal(probe.jar.forUrl('https://sts.slai.edu.cn/'), 'adfs=new-session');
  assert.equal(result.url, 'https://sis.slai.edu.cn/callback');
});
test('代理相对跳转的 307/308 仍禁止跨域转发 POST', async () => {
  for (const statusCode of [307, 308]) {
    const calls = [];
    const probe = new LoginProbe(async options => {
      calls.push(options);
      return { statusCode, header: { Location: '/_slai/sis/callback' } };
    });
    await assert.rejects(probe.request('https://sts.slai.edu.cn/adfs/login', 'POST', 'Password=test'), /跨域 POST/);
    assert.equal(calls.length, 1);
  }
});
test('认证表单支持代理根相对 action，并拒绝越界路径及其他逻辑域', async () => {
  const actions = ['/_slai/sts/adfs/login?state=a%2Bb', '/_slai/sis/callback', '/_slai/other/login', ...unsafePaths];
  for (const action of actions) {
    const calls = [];
    const replies = [
      { statusCode: 302, header: { Location: '/_slai/sts/adfs/login' } },
      { statusCode: 200, header: {}, data: `<form id="loginForm" action="${action}"></form>FormsAuthentication` },
      { statusCode: 302, header: { Location: '/_slai/sis/callback' } },
      { statusCode: 200, header: {}, data: 'ok' }
    ];
    const probe = new LoginProbe(async options => { calls.push(options); return replies.shift(); });
    if (action === actions[0]) {
      await probe.authenticate('https://sis.slai.edu.cn/start', 'demo@example.invalid', 'test-only');
      assert.equal(calls[2].url, 'https://openslai.cn' + action);
      assert.equal(calls[2].method, 'POST');
      assert.match(calls[2].data, /Password=test-only/);
      assert.equal(calls[3].method, 'GET');
      assert.equal(calls[3].data, '');
    } else {
      await assert.rejects(probe.authenticate('https://sis.slai.edu.cn/start', 'demo@example.invalid', 'test-only'));
      assert.equal(calls.length, 2, action);
      assert.ok(calls.every(call => call.method === 'GET' && call.data === ''), action);
    }
  }
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
test('308 同域代理相对跳转保留 POST，303 随后切换为 GET', async () => {
  const calls = [];
  const replies = [
    { statusCode: 308, header: { Location: '/_slai/sts/adfs/next' } },
    { statusCode: 303, header: { Location: '?done=1' } },
    { statusCode: 200, header: {}, data: '' }
  ];
  const probe = new LoginProbe(async options => { calls.push(options); return replies.shift(); });
  await probe.request('https://sts.slai.edu.cn/adfs/login', 'POST', 'Password=test');
  assert.deepEqual(calls.map(call => [call.method, call.data]), [['POST', 'Password=test'], ['POST', 'Password=test'], ['GET', '']]);
  assert.equal(calls[1].url, 'https://openslai.cn/_slai/sts/adfs/next');
  assert.equal(calls[2].url, 'https://openslai.cn/_slai/sts/adfs/next?done=1');
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
