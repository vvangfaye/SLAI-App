const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { estimate, classify } = require('../miniprogram/utils/live-attendance');
const { parsePage } = require('../miniprogram/services/punches');
const campus = require('../miniprogram/services/campus');
const store = require('../miniprogram/services/store');
const sample = require('../examples/campus-data.json');
const day = '2026-09-14';
const RealDate = Date;
const at = (hour, minute = 0, second = 0) => new RealDate(2026, 8, 14, hour, minute, second);
const punch = (time, event, extras = {}) => ({ id: time + event, date: day, time, event, place: '教学楼', channel: event === '进门' ? '闸机-西1-入' : '闸机-西1-出', result: '成功', ...extras });
const visits = () => [punch('09:00:00', '进门'), punch('12:00:00', '出门'), punch('14:00:00', '进门')];
let now, originalCampus, intervals;
beforeEach(() => {
  now = at(15, 30).getTime(); intervals = new Map();
  const memory = new Map();
  global.wx = { getStorageSync: key => memory.get(key), setStorageSync: (key, value) => memory.set(key, value), removeStorageSync: key => memory.delete(key) };
  originalCampus = { connected: campus.connected, remembered: campus.remembered, ready: campus.ready, punches: campus.punches };
  campus.connected = () => true; campus.remembered = () => false; campus.ready = async () => {};
  campus.punches = async () => visits();
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
});
afterEach(() => { global.Date = RealDate; Object.assign(campus, originalCampus); });
function page(name, t) {
  t.mock.method(global, 'setInterval', callback => { const id = intervals.size + 1; intervals.set(id, callback); return id; });
  t.mock.method(global, 'clearInterval', id => { intervals.delete(id); });
  let p; global.Page = value => { p = value; };
  const file = require.resolve(`../miniprogram/pages/${name}/index`); delete require.cache[file]; require(file);
  p.data = { ...p.data }; p.setData = value => Object.assign(p.data, value);
  store.saveSchoolSchedule(sample, true);
  return p;
}
test('保留学校地点类型，按用户提供的通道区分学院和宿舍', () => {
  const row = parsePage({ code: 0, count: 1, data: [{ id: 'a', swipeTime: day + ' 09:00:00', eventType: '进门', channelName: '闸机-西1-入', swipeType: '教学楼', openingResult: '成功' }] }).records[0];
  assert.equal(row.place, '教学楼'); assert.equal(classify(row), 'campus');
  assert.equal(classify({ ...row, place: '', channel: '闸机-西1-出' }), 'campus');
  for (const channel of ['宿舍_道闸出', '宿舍_道闸入']) assert.equal(classify({ ...row, place: '', channel }), 'dorm');
  assert.equal(classify({ ...row, place: '宿舍楼' }), 'dorm');
  const inferred = estimate([punch('09:00:00', '', { place: '', channel: '闸机-西1-入' })], day, at(10));
  assert.equal(inferred.minutes, 60); assert.equal(inferred.status, '出勤中');
});
test('多次进出逐段累计，离校间隔不计时，最后一次进出决定状态', () => {
  const rows = [...visits(), punch('16:00:00', '出门'), punch('17:00:00', '进门'), punch('18:00:00', '出门')];
  const inside = estimate(rows.slice().reverse(), day, at(15, 30));
  assert.equal(inside.minutes, 270); assert.equal(inside.status, '出勤中');
  assert.equal(inside.completedDuration, '3 小时 0 分'); assert.match(inside.hint, /4 小时 30 分/);
  assert.match(inside.targetText, /预计 17:00 达到/);
  assert.equal(estimate(rows, day, at(16, 15)).minutes, 300);
  assert.equal(estimate(rows, day, at(16, 15)).status, '未出勤');
  assert.equal(estimate(rows, day, at(17, 30)).minutes, 330);
  const ended = estimate(rows, day, at(23));
  assert.equal(ended.minutes, 360); assert.equal(ended.status, '未出勤'); assert.equal(ended.sessions.length, 3);
  assert.equal(ended.targetText, '已达到个人目标');
});
test('宿舍出入和失败开门不会开始、结束或增加学院时长', () => {
  const rows = [...visits(), punch('15:00:00', '出门', { result: '失败' }), punch('16:00:00', '出门'),
    punch('08:00:00', '出门', { place: '', channel: '宿舍_道闸出' }), punch('18:00:00', '进门', { place: '', channel: '宿舍_道闸入' })];
  assert.equal(estimate(rows, day, at(15, 30)).minutes, 270);
  const ended = estimate(rows, day, at(20));
  assert.equal(ended.minutes, 300); assert.equal(ended.status, '未出勤');
  assert.equal(ended.counts.dorm, 2); assert.equal(ended.counts.failed, 1);
  assert.equal(estimate(rows.filter(row => classify(row) === 'dorm'), day, at(20)).minutes, 0);
});
test('同秒同向重复刷卡与连续进门不重复累计，按秒合计后取整分钟', () => {
  const rows = [punch('09:00:00', '进门'), punch('09:05:00', '进门'), punch('12:00:00', '出门'), punch('12:00:00', '出门', { id: 'other-gate', channel: '闸机-西2-出' })];
  const result = estimate(rows, day, at(15));
  assert.equal(result.minutes, 180); assert.equal(result.sessions.length, 1); assert.equal(result.counts.unmatched, 0);
  const short = [punch('09:00:00', '进门'), punch('09:00:40', '出门'), punch('10:00:00', '进门'), punch('10:00:40', '出门')];
  assert.equal(estimate(short, day, at(11)).minutes, 1);
});
test('缺进门不从零点补时长，未识别记录和同秒相反方向不推断仍在学院', () => {
  const orphan = estimate([punch('10:00:00', '出门')], day, at(11));
  assert.equal(orphan.minutes, 0); assert.equal(orphan.status, '未出勤'); assert.match(orphan.warning, /缺少对应进门/);
  const uncertain = estimate([...visits(), punch('15:00:00', '出门', { result: '' })], day, at(16));
  assert.equal(uncertain.status, '待核对'); assert.equal(uncertain.minutes, 180); assert.ok(uncertain.warning);
  const sameSecond = [punch('14:00:00', '进门'), punch('14:00:00', '出门')];
  assert.equal(estimate(sameSecond, day, at(15)).status, '待核对');
  assert.deepEqual(estimate(sameSecond, day, at(15)), estimate(sameSecond.reverse(), day, at(15)));
});
test('只计算当天且不读取未来流水，不把昨天未出门累计到今天', () => {
  assert.equal(estimate([punch('09:00:00', '进门')], day, new RealDate(2026, 8, 15)), null);
  const result = estimate([punch('23:00:00', '进门', { date: '2026-09-13' }), punch('16:00:00', '进门')], day, at(15));
  assert.equal(result.minutes, 0); assert.equal(result.status, '未出勤');
});
test('首页本地走时、定时刷新进出状态，刷新失败冻结快照并保留学校汇总', async t => {
  const p = page('home', t);
  store.saveSchoolMonth('2026-09', [{ date: day, minutes: 0, qualified: null }]);
  const stored = JSON.stringify(store.read());
  await p.onShow(); assert.equal(p.data.live.minutes, 270); assert.equal(p.data.live.status, '出勤中');
  now = at(15, 45).getTime(); p.liveAttemptAt = now; p.tickAttendance(); assert.equal(p.data.live.minutes, 285);
  campus.punches = async () => { throw new Error('网络异常'); };
  await p.refreshPunches(); assert.equal(p.data.live.status, '待更新'); assert.equal(p.data.live.minutes, 270);
  now = at(16).getTime(); p.renderLiveAttendance(); assert.equal(p.data.live.minutes, 270);
  campus.punches = async () => [...visits(), punch('15:40:00', '出门')];
  let pending; const refresh = p.refreshPunches; p.refreshPunches = () => (pending = refresh.call(p));
  p.liveAttemptAt = now - 60001; p.tickAttendance(); await pending;
  assert.equal(p.data.live.minutes, 280); assert.equal(p.data.live.status, '未出勤');
  assert.equal(JSON.stringify(store.read()), stored);
  p.onHide(); assert.equal(intervals.size, 0); assert.equal(p.data.live, null);
});
test('考勤今天自动展示估算，历史汇总保持学校数值，切换日期丢弃迟到响应', async t => {
  const p = page('attendance', t);
  store.saveSchoolMonth('2026-09', [{ date: '2026-09-13', minutes: 350, qualified: true }]);
  await p.onShow(); assert.equal(p.data.live.minutes, 270);
  let finish; campus.punches = () => new Promise(resolve => { finish = resolve; });
  const pending = p.refreshPunches();
  p.changeMonth({ detail: { value: '2026-08' } }); finish(visits()); await pending;
  assert.equal(p.data.live, null); assert.deepEqual(p.data.punches, []);
  campus.punches = async () => [];
  p.setData({ month: '2026-09' }); await p.selectDay({ currentTarget: { dataset: { date: '2026-09-13' } } });
  assert.equal(p.data.live, null); assert.equal(p.data.selected.minutes, 350); assert.equal(p.data.selected.status, '合格');
  p.onUnload(); assert.equal(intervals.size, 0);
});
test('首页跨午夜清空昨日估算并重取当日流水，隐藏后的响应不恢复状态', async t => {
  const p = page('home', t); await p.onShow();
  now = new RealDate(2026, 8, 15, 0, 1).getTime();
  let requested, pending; campus.punches = async date => { requested = date; return []; };
  const refresh = p.refreshPunches; p.refreshPunches = () => (pending = refresh.call(p));
  p.tickAttendance(); assert.equal(p.data.live, null); await pending;
  assert.equal(requested, '2026-09-15'); assert.equal(p.data.live.minutes, 0);
  let finish, started; const began = new Promise(resolve => { started = resolve; });
  campus.punches = () => new Promise(resolve => { finish = resolve; started(); });
  const late = p.refreshPunches(); await began; p.onHide(); finish([]); await late;
  assert.equal(p.data.live, null); assert.equal(intervals.size, 0);
});
test('考勤页隔夜重新打开时跟随今天，首次请求失败不会显示未出勤或零时长', async t => {
  const p = page('attendance', t);
  campus.punches = async () => { throw new Error('网络异常'); };
  await p.onShow(); assert.equal(p.data.live, null); assert.equal(p.data.punchStatus, '网络异常'); assert.equal(p.data.selectedToday, true);
  p.onHide(); now = new RealDate(2026, 8, 15, 8).getTime();
  campus.punches = async date => { assert.equal(date, '2026-09-15'); return []; };
  await p.onShow(); assert.equal(p.data.selectedDate, '2026-09-15'); assert.equal(p.data.live.minutes, 0);
  p.onHide();
});
