const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../miniprogram/services/campus-data');
const store = require('../miniprogram/services/store');
const campus = require('../miniprogram/services/campus');
const { LoginProbe } = require('../miniprogram/services/login-probe');
const row = { kcmc: '测试课程', xqj: '2', jcs: '1-2', oldzc: '3', sxbj: '1' };
const periods = [{ qssj: '08:00', jssj: '08:45' }, { qssj: '08:55', jssj: '09:40' }];
const semester = { year: '2026-2027', semester: '1', week: '1' };
const snapshot = () => parser.schedule(semester, { kbList: [row] }, periods, '2026-09-11');
const ledger = rows => ({ success: true, weeks: [{ range: '' }], data: { week1: rows } });
let memory;
beforeEach(async () => { await campus.logout(); memory = new Map(); global.wx = { getStorageSync: k => memory.get(k), setStorageSync: (k,v) => memory.set(k,v), removeStorageSync: k => memory.delete(k) }; });
test('课程锚定学校周次并使用精确结束时间，sxbj不误删双周', () => {
  const result = snapshot(); assert.equal(result.semesterStart, '2026-09-07'); assert.equal(result.courses[0].end, '09:40'); assert.deepEqual(result.courses[0].weeks, [1,2]);
  assert.deepEqual(parser.weeks({ zcd: '1-5周(单),8-10周(双)' }), [1,3,5,8,10]);
  assert.throws(() => parser.schedule({}, { kbList: [row] }, periods));
  assert.throws(() => parser.schedule(semester, { kbList: [row] }, []));
});
test('考勤使用服务器秒数和判定，过滤跨月周，不以个人目标推断', () => {
  const result = parser.attendance(ledger([{ date: '2026-08-31', duration: 300, isQual: '否' }, { date: '2026-09-01', duration: '36061', isQual: '否' }, { date: '2026-09-02', durationStr: '06:03:59', isQual: '待审核' }]), '2026-09');
  assert.deepEqual(result, [{ date: '2026-09-01', minutes: 601, qualified: false }, { date: '2026-09-02', minutes: 363, qualified: null }]);
  assert.throws(() => parser.attendance(ledger([{ date: '2026-09-01' }]), '2026-09'));
  assert.throws(() => parser.attendance({ success: false, weeks: [], data: {} }, '2026-09'));
});
test('按月替换保留其他月份，新账号同步不混入旧账号考勤', () => {
  store.saveSchoolSchedule(snapshot(), true);
  store.saveSchoolMonth('2026-09', [{ date: '2026-09-01', minutes: 20, qualified: null }]);
  store.saveSchoolMonth('2026-10', [{ date: '2026-10-01', minutes: 30, qualified: false }]);
  store.saveSchoolMonth('2026-09', []); assert.equal(store.read().attendance.length, 1);
  store.saveSchoolSchedule(snapshot(), false); assert.equal(store.read().attendance.length, 1);
  assert.throws(() => store.saveSchoolMonth('2026-10', [{ date: 'bad' }])); assert.equal(store.read().attendance.length, 1);
  store.saveSchoolSchedule(snapshot(), true); assert.equal(store.read().attendance.length, 0); assert.deepEqual(store.read().months, {});
});
test('同步考勤失败保留新课表，重试成功；会话过期不覆盖缓存', async () => {
  const original = LoginProbe.prototype.request, auth = LoginProbe.prototype.authenticate;
  let broken = true, expired = false;
  LoginProbe.prototype.authenticate = async function () {};
  LoginProbe.prototype.request = async function (url) {
    if (expired) return { statusCode: 401, url, data: '' };
    if (url.includes('stu.') && broken) throw new Error('network');
    let data = url.includes('CurrentSemester') ? semester : url.includes('cxXsKb') ? { kbList: [row] } : url.includes('cxRjc') ? periods : url.includes('weekGrouped') ? ledger([{ date: '2026-09-01', duration: 60, isQual: '是' }]) : {};
    return { statusCode: 200, url, data: JSON.stringify(data) };
  };
  try {
    await assert.rejects(campus.sync({ username: 'test', password: 'fixture', month: '2026-09' }), /课表已保留/);
    assert.equal(store.read().source, 'school'); assert.equal(store.read().courses.length, 1);
    broken = false; await campus.sync({ month: '2026-09', monthOnly: true }); assert.equal(store.read().attendance[0].minutes, 1);
    const saved = JSON.stringify([...memory]); assert.ok(!saved.includes('fixture'));
    expired = true; await assert.rejects(campus.sync(), /过期/); assert.equal(JSON.stringify([...memory]), saved); assert.equal(campus.connected(), false);
  } finally { LoginProbe.prototype.request = original; LoginProbe.prototype.authenticate = auth; campus.logout(); }
});
