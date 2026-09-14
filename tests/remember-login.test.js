const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { LoginProbe } = require('../miniprogram/services/login-probe');
const store = require('../miniprogram/services/store');
let campus, cache, plain, encrypted, writes, authCalls, failedAuth, failedNetwork, expired, monthFailed, encryptionFailed;
const originalAuth = LoginProbe.prototype.authenticate, originalRequest = LoginProbe.prototype.request;
const KEY = 'hetao.login.encrypted.v1';
const creds = { username: 'student@example.edu', password: 'test-secret-only' };
function coldStart() {
  for (const name of ['campus', 'login-cache']) delete require.cache[require.resolve('../miniprogram/services/' + name)];
  campus = require('../miniprogram/services/campus'); cache = require('../miniprogram/services/login-cache');
}
beforeEach(() => {
  plain = new Map(); encrypted = new Map(); writes = []; authCalls = 0;
  failedAuth = failedNetwork = expired = monthFailed = encryptionFailed = false;
  global.wx = {
    canIUse: () => true,
    getStorageSync: key => plain.get(key),
    setStorageSync: (key, value) => plain.set(key, value),
    removeStorageSync: key => { plain.delete(key); encrypted.delete(key); },
    // Model encrypted storage separately; every access must use the encryption flag.
    setStorage: options => {
      assert.equal(options.encrypt, true); writes.push(options.key);
      if (encryptionFailed) { options.fail({ errMsg: 'disk full' }); return; }
      encrypted.set(options.key, JSON.parse(JSON.stringify(options.data))); options.success({});
    },
    getStorage: options => {
      assert.equal(options.encrypt, true);
      if (encrypted.has(options.key)) options.success({ data: encrypted.get(options.key) });
      else options.fail({ errMsg: 'getStorage:fail data not found' });
    }
  };
  coldStart();
  LoginProbe.prototype.authenticate = async function (entry, username, password) {
    authCalls++;
    assert.equal(entry, 'https://sis.slai.edu.cn/yjsxt/htxylogin');
    assert.ok(username && password);
    if (failedNetwork) throw new Error('网络错误');
    if (failedAuth) { const e = new Error('学校要求重新认证'); e.code = 'AUTH_REQUIRED'; throw e; }
    expired = false;
  };
  LoginProbe.prototype.request = async function (url) {
    if (expired) return { statusCode: 401, url, data: '' };
    if (monthFailed && url.includes('stu.')) throw new Error('network');
    let data = {};
    if (url.includes('CurrentSemester')) data = { year: '2026-2027', semester: '1', week: '1' };
    else if (url.includes('cxXsKb')) data = { kbList: [] };
    else if (url.includes('cxRjc')) data = [{ qssj: '08:00', jssj: '08:45' }];
    else if (url.includes('weekGrouped')) data = { success: true, weeks: [], data: { week1: [{ date: '2026-09-01', duration: 3600, isQual: '是' }] } };
    else if (url.includes('listData')) data = { code: 0, count: 0, data: [] };
    return { statusCode: 200, url, data: JSON.stringify(data) };
  };
});
afterEach(async () => {
  await campus.logout();
  LoginProbe.prototype.authenticate = originalAuth; LoginProbe.prototype.request = originalRequest;
});

test('仅成功登录使用加密缓存，冷启动自动登录并保留其他月份数据', async () => {
  const result = await campus.sync({ ...creds, remember: true, month: '2026-09' });
  assert.equal(result.remembered, true); assert.deepEqual(writes, [KEY]);
  assert.equal(JSON.stringify([...plain]).includes(creds.password), false);
  assert.equal(JSON.stringify([...plain]).includes(creds.username), false);
  store.saveSchoolMonth('2026-08', [{ date: '2026-08-31', minutes: 42, qualified: null }]);
  coldStart(); await campus.ready();
  assert.equal(campus.connected(), false); assert.equal(campus.remembered(), true);
  await campus.sync({ month: '2026-09' }); assert.equal(authCalls, 2); assert.equal(campus.connected(), true);
  assert.ok(store.read().attendance.some(row => row.date === '2026-08-31'));
});

test('会话过期仅重登一次，教务与考勤路径都可恢复', async () => {
  await campus.sync({ ...creds, remember: true, month: '2026-09' });
  expired = true; await campus.sync({ month: '2026-09' }); assert.equal(authCalls, 2);
  expired = true; await campus.punches('2026-09-01'); assert.equal(authCalls, 3);
  const request = LoginProbe.prototype.request;
  LoginProbe.prototype.request = async url => ({ statusCode: 401, url, data: '' });
  await assert.rejects(campus.sync({ month: '2026-09' }), /过期/);
  assert.equal(authCalls, 4); assert.equal(campus.remembered(), false);
  assert.equal(encrypted.has(KEY), false);
  LoginProbe.prototype.request = request;
});

test('密码失效停止自动重试，网络失败保留加密凭据', async () => {
  await campus.sync({ ...creds, remember: true, month: '2026-09' });
  coldStart(); failedNetwork = true;
  await assert.rejects(campus.punches('2026-09-01'), /网络/);
  assert.equal(campus.remembered(), true); assert.equal(encrypted.has(KEY), true);
  failedNetwork = false; failedAuth = true;
  await assert.rejects(campus.punches('2026-09-01'), /重新验证/);
  assert.equal(campus.remembered(), false); assert.equal(encrypted.has(KEY), false);
  const calls = authCalls;
  await assert.rejects(campus.punches('2026-09-01'), /请先登录/); assert.equal(authCalls, calls);
});

test('登录失败不保存密码，考勤网络失败后已成功的登录仍可记住', async () => {
  failedAuth = true;
  await assert.rejects(campus.sync({ ...creds, remember: true }), /认证/); assert.equal(writes.length, 0);
  failedAuth = false; monthFailed = true;
  await assert.rejects(campus.sync({ ...creds, remember: true, month: '2026-09' }), /课表已保留/);
  assert.equal(campus.remembered(), true); assert.equal(encrypted.has(KEY), true);
});

test('取消记住登录与切换账号清除旧凭据，退出后不能再恢复', async () => {
  await campus.sync({ ...creds, remember: true, month: '2026-09' });
  await campus.sync({ username: 'other@example.edu', password: 'other-test', remember: false, month: '2026-09' });
  assert.equal(campus.remembered(), false); assert.equal(encrypted.has(KEY), false);
  assert.equal(campus.connected(), true);
  await campus.logout(); coldStart(); await campus.ready();
  assert.equal(campus.remembered(), false); assert.equal(campus.connected(), false);
});

test('并发读取只发起一次自动认证', async () => {
  await campus.sync({ ...creds, remember: true, month: '2026-09' });
  coldStart(); await campus.ready();
  let release; const auth = LoginProbe.prototype.authenticate;
  LoginProbe.prototype.authenticate = async function (...args) { await new Promise(resolve => { release = resolve; }); return auth.apply(this, args); };
  const a = campus.punches('2026-09-01'), b = campus.punches('2026-09-02');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(typeof release, 'function'); release(); await Promise.all([a, b]); assert.equal(authCalls, 2);
});

test('退出发生在保存过程中，迟到写入不能重新记住密码', async () => {
  let release, started;
  const began = new Promise(resolve => { started = resolve; });
  wx.setStorage = options => { assert.equal(options.encrypt, true); release = () => { encrypted.set(options.key, options.data); options.success({}); }; started(); };
  const login = campus.sync({ ...creds, remember: true, month: '2026-09' });
  const rejected = assert.rejects(login, /取消/);
  await began; const logout = campus.logout(); release(); await Promise.all([logout, rejected]);
  assert.equal(encrypted.has(KEY), false); assert.equal(campus.remembered(), false); assert.equal(campus.connected(), false);
  coldStart(); await campus.ready(); assert.equal(campus.remembered(), false);
});

test('退出发生在自动认证过程中，迟到响应不能恢复会话或写入数据', async () => {
  await campus.sync({ ...creds, remember: true, month: '2026-09' });
  coldStart(); await campus.ready();
  let release, started; const began = new Promise(resolve => { started = resolve; });
  LoginProbe.prototype.authenticate = async () => { await new Promise(resolve => { release = resolve; started(); }); };
  const cached = JSON.stringify(store.read());
  const request = campus.sync({ month: '2026-09' });
  const rejected = assert.rejects(request, /取消/);
  await began; await campus.logout(); release(); await rejected;
  assert.equal(campus.connected(), false); assert.equal(campus.remembered(), false);
  assert.equal(encrypted.has(KEY), false); assert.equal(JSON.stringify(store.read()), cached);
});

test('不支持加密或加密存储失败时不降级明文，登录仍可本次使用', async () => {
  wx.canIUse = () => false;
  const unsupported = await campus.sync({ ...creds, remember: true, month: '2026-09' });
  assert.match(unsupported.rememberWarning, /更新微信/); assert.equal(campus.connected(), true); assert.equal(campus.remembered(), false);
  assert.equal(writes.length, 0); assert.equal(JSON.stringify([...plain]).includes(creds.password), false);
  wx.canIUse = () => true; encryptionFailed = true;
  const failed = await campus.sync({ ...creds, remember: true, month: '2026-09' });
  assert.match(failed.rememberWarning, /存储空间/); assert.equal(campus.remembered(), false); assert.equal(encrypted.has(KEY), false);
});
