const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sample = require('../examples/campus-data.json');
const store = require('../miniprogram/services/store');
let memory; let modalConfirm;
beforeEach(() => {
  memory = new Map(); modalConfirm = true;
  global.wx = {
    getStorageSync: key => memory.get(key), setStorageSync: (key, value) => memory.set(key, value), removeStorageSync: key => memory.delete(key),
    showToast() {}, navigateBack() {}, switchTab() {}, navigateTo() {},
    showModal(opts) { if (opts.success) opts.success({ confirm: modalConfirm }); if (opts.complete) opts.complete(); }
  };
});
function page(name) {
  let p; global.Page = opts => { p = opts; };
  const file = require.resolve(`../miniprogram/pages/${name}/index`); delete require.cache[file]; require(file);
  p.data = { ...p.data }; p.setData = update => Object.assign(p.data, update); return p;
}
test('损坏缓存不伪装为演示数据、不删除原始内容', () => {
  memory.set('slaier.data.v1', { version: 99 });
  assert.equal(store.read().source, 'error'); assert.equal(memory.get('slaier.data.v1').version, 99);
});
test('四个主页面可以加载，周次、月份和偏好交互生效', () => {
  store.saveSchoolSchedule(sample, true); store.saveSchoolMonth('2026-09', sample.attendance);
  for (const name of ['home', 'schedule', 'attendance', 'settings']) { const p = page(name); p.onShow(); assert.match(p.data.label, /学校数据/); }
  const schedule = page('schedule'); schedule.onShow(); const first = schedule.data.month;
  schedule.next(); assert.notEqual(schedule.data.month, first); schedule.current(); assert.equal(schedule.data.month, first);
  const attendance = page('attendance'); attendance.changeMonth({ detail: { value: '2026-09' } }); assert.equal(attendance.data.qualified, 1);
  attendance.changeMonth({ detail: { value: '2026-10' } }); assert.equal(attendance.data.rows.length, 0);
  const settings = page('settings'); settings.targetChange({ detail: { value: 8 } }); settings.showChange({ detail: { value: false } });
  const home = page('home'); home.onShow(); assert.equal(home.data.target, 8); assert.equal(home.data.showCourses, false);
});
test('全部注册页面存在，模板事件均有对应方法', () => {
  const app = require('../miniprogram/app.json');
  const allowed = new Set(['form', 'view', 'text', 'button', 'block', 'switch', 'slider', 'picker', 'textarea', 'input']);
  for (const route of app.pages) {
    const file = path.resolve(__dirname, '../miniprogram', route + '.wxml'); const template = fs.readFileSync(file, 'utf8');
    const p = page(route.split('/')[1]);
    for (const m of template.matchAll(/bind\w+="([^"]+)"/g)) assert.equal(typeof p[m[1]], 'function', m[1]);
    for (const m of template.matchAll(/<([a-z][\w-]*)\b/g)) assert.ok(allowed.has(m[1]), m[1]);
  }
});
test('考勤展开与收起正确，切换页面后丢弃迟到的明细响应', async () => {
  const campus = require('../miniprogram/services/campus');
  const p = page('attendance'); p.onShow();
  const event = { currentTarget: { dataset: { date: '2026-09-11' } } };
  await p.toggleDay(event); assert.equal(p.data.expanded, '2026-09-11'); assert.match(p.data.punchStatus, /登录并同步/);
  await p.toggleDay(event); assert.equal(p.data.expanded, '');
  store.saveSchoolSchedule(sample, true);
  const original = campus.punches; let finish;
  campus.punches = () => new Promise(resolve => { finish = resolve; });
  try { const pending = p.toggleDay(event); p.onHide(); finish([{ time: '08:00:00' }]); await pending; assert.deepEqual(p.data.punches, []); }
  finally { campus.punches = original; }
});

 test('自动填充从表单读取，成功跳首页且不退出会话，失败留在登录页', async () => {
  const campus = require('../miniprogram/services/campus');
  const originalSync = campus.sync, originalLogout = campus.logout;
  const p = page('login'); let submitted, navigated = 0, loggedOut = 0;
  campus.sync = async values => { submitted = values; };
  campus.logout = () => { loggedOut++; };
  wx.switchTab = options => { assert.equal(options.url, '/pages/home/index'); navigated++; p.onUnload(); };
  try {
    await p.login({ detail: { value: { username: ' test@example.edu ', password: 'test-only' } } });
    assert.equal(submitted.username, 'test@example.edu'); assert.equal(submitted.password, 'test-only');
    assert.equal(navigated, 1); assert.equal(loggedOut, 0); assert.equal(p.data.password, '');
    const failed = page('login'); campus.sync = async () => { throw new Error('登录失败'); };
    await failed.login({ detail: { value: { username: 'test@example.edu', password: 'test-only' } } });
    assert.equal(navigated, 1); assert.equal(failed.data.status, '登录失败'); assert.equal(failed.data.busy, false);
  } finally { campus.sync = originalSync; campus.logout = originalLogout; }
 });

test('日常加载今日打卡，空记录与失败明确区分，隐藏后丢弃旧响应', async () => {
  const campus = require('../miniprogram/services/campus');
  const original = { connected: campus.connected, punches: campus.punches };
  const today = require('../miniprogram/utils/domain').dateKey();
  store.saveSchoolSchedule(sample, true);
  campus.connected = () => true;
  try {
    const rows = [{ id: '1', time: '08:30:00', event: '进门', channel: '东门' }];
    campus.punches = async date => { assert.equal(date, today); return rows; };
    const p = page('home'); await p.onShow(); assert.deepEqual(p.data.punches, rows);
    campus.punches = async () => []; await p.refreshPunches(); assert.equal(p.data.punchStatus, '今日暂无打卡');
    campus.punches = async () => { throw new Error('网络异常'); }; await p.refreshPunches(); assert.equal(p.data.punchStatus, '网络异常');
    let finish, began; const started = new Promise(resolve => { began = resolve; });
    campus.punches = () => new Promise(resolve => { finish = resolve; began(); });
    const pending = p.refreshPunches(); await started; p.onHide(); finish(rows); await pending; assert.deepEqual(p.data.punches, []);
    campus.connected = () => false; await p.onShow(); assert.equal(p.data.needsLogin, true); assert.deepEqual(p.data.punches, []);
  } finally { Object.assign(campus, original); }
});

 test('密码填充保持绑定值，表单漏值时仍能提交，主动清空不会复用旧密码', async () => {
  const campus = require('../miniprogram/services/campus');
  const original = campus.sync; let submitted, calls = 0;
  campus.sync = async value => { submitted = value; calls++; };
  try {
    const p = page('login');
    p.userInput({ detail: { value: 'test@example.edu' } });
    p.passwordInput({ detail: { value: 'test-only' } });
    assert.equal(p.data.password, 'test-only');
    await p.login({ detail: { value: { username: '', password: '' } } });
    assert.equal(submitted.password, 'test-only'); assert.equal(p.data.password, ''); assert.equal(p.password, '');
    const cleared = page('login'); cleared.userInput({ detail: { value: 'test@example.edu' } });
    cleared.passwordInput({ detail: { value: 'test-only' } });
    cleared.passwordInput({ detail: { value: '' } });
    await cleared.login({ detail: { value: { username: 'test@example.edu', password: '' } } });
    assert.equal(calls, 1); assert.match(cleared.data.status, /请填写/);
  } finally { campus.sync = original; }
 });

test('登录表单接收非聚焦填充事件并同步账号密码', () => {
  const template = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/login/index.wxml'), 'utf8');
  const p = page('login');
  for (const [name, value] of [['username', 'test@example.edu'], ['password', 'test-only']]) {
    const input = [...template.matchAll(/<input\b[^>]*>/g)].map(m => m[0]).find(tag => tag.includes(`name="${name}"`));
    const handler = input.match(/bindchange="([^"]+)"/)[1];
    p[handler]({ detail: { value } });
    assert.equal(p.data[name], value);
  }
});

test('填充对照在输入期间不重绘，只报告值是否存在，提交后移除输入框', () => {
  wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'develop' } });
  wx.getSystemInfoSync = () => ({ system: 'iOS test', version: 'test', SDKVersion: 'test' });
  const p = page('fill-check'); p.onLoad();
  const originalSetData = p.setData; const updates = [];
  p.setData = update => { updates.push(update); originalSetData(update); };
  const account = 'private-test@example.edu', password = 'private-test-password';
  p.track({ type: 'focus', currentTarget: { dataset: { field: 'password' } }, detail: { value: '' } });
  p.track({ type: 'change', currentTarget: { dataset: { field: 'password' } }, detail: { value: password } });
  p.track({ type: 'change', currentTarget: { dataset: { field: 'password' } }, detail: { value: password + 'more' } });
  assert.equal(p.trace.length, 2);
  assert.equal(updates.length, 0);
  p.check({ detail: { value: { username: account, password } } });
  assert.equal(p.data.checked, true); assert.equal(p.data.result, '原生表单收到密码');
  assert.match(p.data.report, /密码 change: 有值/);
  assert.equal(JSON.stringify({ data: p.data, trace: p.trace, updates }).includes(password), false);
  assert.equal(JSON.stringify({ data: p.data, trace: p.trace, updates }).includes(account), false);
  assert.equal(memory.size, 0);
  p.retry(); p.check({ detail: { value: {} } }); assert.equal(p.data.result, '原生表单未收到密码');
  p.onUnload(); assert.deepEqual(p.trace, []);
});

test('正式版不启用填充检查，外来诊断字段不进入报告', () => {
  const diagnostics = require('../miniprogram/utils/fill-diagnostics');
  wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'release' } });
  let route; wx.switchTab = opts => { route = opts.url; };
  const p = page('fill-check'); p.onLoad();
  assert.equal(route, '/pages/home/index'); assert.equal(p.data.enabled, false);
  const result = diagnostics.readTrace(encodeURIComponent(JSON.stringify([
    { field: 'password', type: 'input', hasValue: true, value: 'must-not-survive' },
    { field: 'unknown-secret', type: 'input', hasValue: true },
    { field: 'password', type: 'input', hasValue: 'must-not-survive' }
  ])));
  assert.deepEqual(result, [{ field: 'password', type: 'input', hasValue: true }]);
});
