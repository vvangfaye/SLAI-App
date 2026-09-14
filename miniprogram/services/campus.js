const { LoginProbe } = require('./login-probe');
const parse = require('./campus-data');
const store = require('./store');
const d = require('../utils/domain');
const loginCache = require('./login-cache');
let session = null;
let busy = false;
let revision = 0;
let savedLogin = null;
let restoring = null;
let authenticating = null;
function invalidate(client) { if (client) client.close(); if (session === client) session = null; }
function logout() {
  revision++;
  invalidate(session);
  if (authenticating) authenticating.client.close();
  authenticating = null;
  savedLogin = null;
  restoring = Promise.resolve();
  return loginCache.clear();
}
function connected() { return !!session && !session.cancelled; }
function remembered() { return !!savedLogin; }
function error(message, code) { const e = new Error(message); e.code = code; return e; }
function check(version) { if (version !== revision) throw error('登录操作已取消', 'CANCELLED'); }
function ready() {
  if (!restoring) {
    const version = revision;
    restoring = loginCache.read().then(value => { if (version === revision) savedLogin = value; }).catch(() => {
      if (version === revision) savedLogin = null;
    });
  }
  return restoring;
}
async function authenticate(credentials, version, automatic) {
  check(version);
  if (authenticating && authenticating.version === version) return authenticating.promise;
  const client = new LoginProbe();
  const task = { client, version };
  task.promise = (async () => {
    try {
      await client.authenticate('https://sis.slai.edu.cn/yjsxt/htxylogin', credentials.username, credentials.password);
      check(version);
      if (client.cancelled) throw error('登录操作已取消', 'CANCELLED');
      session = client;
      return client;
    } catch (e) {
      client.close();
      check(version);
      if (automatic && e.code === 'AUTH_REQUIRED') {
        savedLogin = null;
        await loginCache.clear();
        throw error('已保存的登录需要重新验证，请重新登录。', 'AUTH_REQUIRED');
      }
      throw e;
    } finally { if (authenticating === task) authenticating = null; }
  })();
  authenticating = task;
  return task.promise;
}
async function ensureSession(version) {
  check(version);
  if (connected()) return session;
  if (!savedLogin) throw error('请先登录学校账号；已缓存的数据仍可离线查看。', 'SESSION_EXPIRED');
  return authenticate(savedLogin, version, true);
}
async function withLogin(operation) {
  await ready();
  const version = revision;
  let client = await ensureSession(version);
  try { return await operation(client, version); }
  catch (e) {
    check(version);
    if (e.code !== 'SESSION_EXPIRED' || !savedLogin) throw e;
    invalidate(client);
    client = await ensureSession(version);
    try { return await operation(client, version); }
    catch (retryError) {
      check(version);
      if (retryError.code === 'SESSION_EXPIRED') {
        invalidate(client); savedLogin = null; await loginCache.clear();
      }
      throw retryError;
    }
  }
}
async function json(client, url, method = 'GET', body = '') {
  let res;
  try { res = await client.request(url, method, body); }
  catch (e) { if (client.cancelled) throw e; throw error(url.includes('stu.slai.edu.cn') ? '考勤连接失败，请连接校园网或开启可访问学校的 VPN 后重试。' : e.message, 'NETWORK'); }
  if ([401, 403, 901].includes(res.statusCode) || /https:\/\/sts\./.test(res.url) || /loginForm|FormsAuthentication/.test(String(res.data))) {
    invalidate(client);
    throw error('学校登录已过期，请重新登录；本地数据仍保留。', 'SESSION_EXPIRED');
  }
  if (res.statusCode !== 200) throw error('学校接口暂时不可用，请稍后重试。', 'SERVER');
  try { return typeof res.data === 'string' ? JSON.parse(res.data) : res.data; }
  catch (_) { throw error('学校返回了未识别的页面，未覆盖本地数据。', 'SCHEMA'); }
}
async function loadSchedule(client) {
  const semester = await json(client, 'https://sis.slai.edu.cn/yjsxt/xtgl/index_cxCurrentSemester.html?gnmkdm=index', 'POST');
  const year = String(semester.year || '').match(/^\d{4}/), term = { 1: 3, 2: 12, 3: 16 }[semester.semester];
  if (!year || !term) throw error('学校学期格式变化，未覆盖本地数据。', 'SCHEMA');
  const body = `localeKey=zh_CN&xnm=${year[0]}&xqm=${term}&zs=`;
  const payload = await json(client, 'https://sis.slai.edu.cn/yjsxt/kbcx/xskbcx_cxXsKb.html?gnmkdm=index', 'POST', body);
  let periods = [];
  for (const path of ['kbcx', 'xskbcx']) {
    try { const result = await json(client, `https://sis.slai.edu.cn/yjsxt/${path}/xskbcx_cxRjc.html?gnmkdm=index`, 'POST', body); if (Array.isArray(result) && result.length) { periods = result; break; } }
    catch (e) { if (e.code === 'SESSION_EXPIRED' || client.cancelled) throw e; }
  }
  return parse.schedule(semester, payload, periods);
}
async function loadMonth(client, month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('月份格式有误');
  await jsonEntry(client);
  const payload = await json(client, 'https://stu.slai.edu.cn/a/edu/acm/swipe/weekGroupedByMonth', 'POST', `startMonth=${month}&cycleWeek=`);
  return { rows: parse.attendance(payload, month), summary: parse.summary(payload.stats) };
}
async function jsonEntry(client) {
  let res;
  try { res = await client.request('https://stu.slai.edu.cn/sso/login'); }
  catch (_) { throw error('考勤连接失败，请连接校园网或开启可访问学校的 VPN 后重试。', 'NETWORK'); }
  if ([401, 403, 901].includes(res.statusCode) || /https:\/\/sts\./.test(res.url) || /loginForm|FormsAuthentication/.test(String(res.data))) {
    invalidate(client);
    throw error('考勤会话已失效，请重新登录。', 'SESSION_EXPIRED');
  }
  if (res.statusCode !== 200) throw error('考勤入口暂时不可用。', 'SERVER');
}

async function sync({ username, password, remember = false, month = d.dateKey().slice(0, 7), progress = () => {}, monthOnly = false } = {}) {
  if (busy) throw new Error('同步正在进行，请稍候');
  busy = true;
  const fresh = !!username;
  let client;
  let committed = false;
  let rememberWarning = '';
  async function run(activeClient, version) {
    client = activeClient;
    if (!monthOnly || fresh) {
      progress('正在同步课表…');
      const snapshot = await loadSchedule(client);
      check(version);
      if (session !== client || client.cancelled) throw new Error('同步已取消');
      store.saveSchoolSchedule(snapshot, fresh);
      committed = true;
      if (fresh && remember) {
        try {
          const saved = await loginCache.save({ username, password });
          check(version);
          if (saved) savedLogin = { username, password };
        } catch (e) { check(version); rememberWarning = e.message; }
      }
    }
    progress('课表已保存，正在同步考勤…');
    try {
      const snapshot = await loadMonth(client, month);
      check(version);
      if (session !== client || client.cancelled) throw new Error('同步已取消');
      store.saveSchoolMonth(month, snapshot.rows, snapshot.summary);
    } catch (e) { throw error('课表已保留。' + e.message + (rememberWarning ? ' ' + rememberWarning : ''), e.code); }
    progress(rememberWarning || '同步完成');
    return { remembered: remembered(), rememberWarning };
  }
  try {
    if (fresh) {
      const cleared = logout();
      const version = revision;
      await cleared; check(version);
      progress('正在登录学校账号…');
      client = await authenticate({ username, password }, version, false);
      return await run(client, version);
    }
    return await withLogin(run);
  } catch (e) { if (fresh && !committed) invalidate(client); throw e; }
  finally { busy = false; }
}
async function punches(date) {
  if (busy) throw new Error('正在同步校园数据，请稍后展开明细');
  return withLogin(async (client, version) => {
    await jsonEntry(client);
    const records = await require('./punches').fetchDay(query => json(client, 'https://stu.slai.edu.cn/a/edu/acm/swipe/listData?' + query), date);
    check(version);
    if (client !== session || client.cancelled) throw new Error('登录状态已变化，请重新加载');
    return records;
  });
}
module.exports = { sync, logout, connected, remembered, ready, punches };
