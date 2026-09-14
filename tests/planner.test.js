const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const planner = require('../miniprogram/services/planner');
const holidays = require('../miniprogram/utils/holidays');
const stats = require('../miniprogram/utils/month-stats');
const parser = require('../miniprogram/services/campus-data');
const store = require('../miniprogram/services/store');
const d = require('../miniprogram/utils/domain');
const daily = require('../miniprogram/utils/daily');
const ical = require('../miniprogram/utils/ical');
const sample = require('../examples/campus-data.json');
let memory;
beforeEach(() => { memory = new Map(); global.wx = { getStorageSync: k => memory.get(k), setStorageSync: (k, v) => memory.set(k, v), removeStorageSync: k => memory.delete(k), showToast() {} }; });
const leave = (extra = {}) => ({ start: '2026-09-14', end: '2026-09-14', startHalf: 0, endHalf: 1, days: 1, kind: 'annual', status: 'approved', ...extra });
function page(name) { let p; global.Page = data => { p = data; }; const file = require.resolve(`../miniprogram/pages/${name}/index`); delete require.cache[file]; require(file); p.data = { ...p.data }; p.setData = data => Object.assign(p.data, data); return p; }

test('2026 官方假期与六个补班日，未知年份不猜测', () => {
  let off = 0, work = [];
  for (let date = '2026-01-01'; date <= '2026-12-31'; date = d.addDays(date, 1)) { const day = holidays.info(date); if (day.badge === '休') off++; if (day.badge === '班') work.push(date); }
  assert.equal(off, 33);
  assert.deepEqual(work, ['2026-01-04','2026-02-14','2026-02-28','2026-05-09','2026-09-20','2026-10-10']);
  assert.equal(holidays.info('2026-09-25').name, '中秋节'); assert.equal(holidays.info('2026-09-20').workday, true);
  assert.equal(holidays.info('2027-01-01').workday, null); assert.equal(holidays.info('2027-01-01').badge, '');
});
test('半天、补班和放假按所选规则估算，跨年与未知年份拒绝猜测', () => {
  assert.equal(planner.estimate(leave({ start: '2026-09-20', end: '2026-09-27' }), 'workday').charge, 5);
  assert.equal(planner.estimate(leave({ startHalf: 1 }), 'calendar').charge, 0.5);
  assert.equal(planner.estimate(leave({ start: '2026-09-25', end: '2026-09-27' }), 'workday').charge, 0);
  assert.equal(planner.estimate(leave(), 'manual').charge, null);
  assert.throws(() => planner.estimate(leave({ start: '2026-12-31', end: '2027-01-01' }), 'calendar'), /跨年/);
  assert.throws(() => planner.estimate(leave({ start: '2027-01-04', end: '2027-01-04' }), 'workday'), /未收录/);
  assert.throws(() => planner.estimate(leave({ startHalf: 1, endHalf: 0 }), 'calendar'));
});
test('年假只扣已批准，待审批预留，取消和其他假不占用额度', () => {
  planner.saveConfig('2026', { allowance: 10, openingUsed: 2, rule: 'manual' });
  const approved = planner.saveLeave(leave({ days: 0.5, startHalf: 1 }));
  planner.saveLeave(leave({ start: '2026-09-15', end: '2026-09-15', status: 'pending' }));
  planner.saveLeave(leave({ start: '2026-09-16', end: '2026-09-16', status: 'planned' }));
  planner.saveLeave(leave({ start: '2026-09-17', end: '2026-09-17', kind: 'other' }));
  let balance = planner.balance(planner.read(), '2026'); assert.equal(balance.remaining, 7.5); assert.equal(balance.available, 6.5);
  planner.saveLeave({ ...approved, status: 'cancelled' }); balance = planner.balance(planner.read(), '2026'); assert.equal(balance.remaining, 8);
  assert.equal(planner.balance(planner.read(), '2027').remaining, null);
  assert.equal(planner.onDate(planner.read(), approved.start).leaves.length, 0);
});
test('重复时段拒绝，同一天不同半天允许，规则更改不改历史扣假', () => {
  planner.saveConfig('2026', { allowance: 1, openingUsed: 0, rule: 'workday' });
  planner.saveLeave(leave({ startHalf: 0, endHalf: 0, days: 0.5 }));
  assert.throws(() => planner.saveLeave(leave()), /已有/);
  planner.saveLeave(leave({ startHalf: 1, endHalf: 1, days: 0.5 }));
  planner.saveConfig('2026', { allowance: 0.5, openingUsed: 0, rule: 'calendar' });
  assert.equal(planner.balance(planner.read(), '2026').remaining, -0.5);
  assert.throws(() => planner.saveLeave(leave({ start: '2026-09-18', end: '2026-09-18', days: 1.2 })));
  assert.throws(() => planner.saveConfig('2026', { allowance: ' ', openingUsed: 0 }));
});
test('请假与课程时段冲突，日程完成可恢复且不污染学校缓存', () => {
  const data = { version: 1, semesterStart: '2026-09-07', courses: [{ title: '测试课程', weekday: 1, weeks: [2], start: '09:00', end: '10:00', room: '', teacher: '' }], attendance: [] };
  assert.equal(planner.estimate(leave({ endHalf: 0 }), 'manual', data).conflicts.length, 1);
  assert.equal(planner.estimate(leave({ startHalf: 1 }), 'manual', data).conflicts.length, 0);
  const row = planner.saveEvent({ date: '2026-09-14', title: '测试日程', time: '09:00' });
  assert.equal(planner.onDate(planner.read(), row.date).events.length, 1);
  planner.saveEvent({ ...row, done: true }); assert.equal(planner.onDate(planner.read(), row.date).events.length, 0);
  planner.saveEvent({ ...row, done: false }); assert.equal(planner.onDate(planner.read(), row.date).events.length, 1);
  store.clear(); assert.equal(planner.read().events.length, 1); assert.equal(memory.has('slaier.data.v1'), false);
});
test('损坏个人缓存不被默认值或新记录覆盖，写入失败向上返回', () => {
  const damaged = { version: 7 }; memory.set('hetao.personal-planner.v1', damaged);
  assert.throws(() => planner.saveLeave(leave()), /未覆盖/); assert.equal(memory.get('hetao.personal-planner.v1'), damaged);
  memory.clear(); wx.setStorageSync = () => { throw new Error('full'); }; assert.throws(() => planner.saveLeave(leave()), /full/);
});
test('学校月统计零与缺失区分，不从日记录推测，不把补卡额度当年假', () => {
  assert.deepEqual(stats.parse({ requiredPunches: 20, totalValidPunches: '0', isMonthlyQualified: false, maxAllowedRestdayPunches: 3 }), { required: 20, effective: 0, qualified: false });
  assert.equal(stats.view(stats.parse({ requiredPunches: 20 })).remaining, null);
  assert.equal(stats.parse({ actualWorkdayPunches: 5 }).effective, null);
  assert.equal(stats.parse({ actualWorkdayPunches: 5, actualRestdayPunches: 2 }).effective, 7);
  assert.equal(stats.parse({ totalValidPunches: 8, actualWorkdayPunches: 5, actualRestdayPunches: 2 }).effective, 8);
  assert.equal(stats.parse({ totalValidPunches: [], requiredPunches: ' ', isMonthlyQualified: 'unknown' }).effective, null);
  assert.equal(stats.view({ required: 0, effective: 0 }).remaining, 0);
});
test('月统计与请假标记随月份保存，重新登录清除旧账号统计', () => {
  store.saveSchoolSchedule(sample, true);
  const rows = parser.attendance({ success: true, weeks: [{}], data: { week1: [{ date: '2026-09-14', duration: 0, isQual: '否', isLeave: '是' }] } }, '2026-09');
  store.saveSchoolMonth('2026-09', rows, { required: 20, effective: 7, qualified: false });
  store.saveSchoolMonth('2026-10', [], { required: 15, effective: 0, qualified: null });
  store.saveSchoolSchedule(sample, false);
  assert.equal(store.read().summaries['2026-09'].effective, 7); assert.equal(store.read().attendance[0].leave, true);
  store.saveSchoolMonth('2026-09', rows); assert.equal(store.read().summaries['2026-09'].effective, null);
  assert.equal(store.read().summaries['2026-10'].required, 15);
  store.saveSchoolSchedule(sample, true); assert.deepEqual(store.read().summaries, {});
});
test('下一节课跳过已结束课程，识别进行中并跨天寻找', () => {
  const data = { semesterStart: '2026-09-07', courses: [{ title: '上午课', weekday: 1, weeks: [1,2], start: '09:00', end: '10:00' }, { title: '下午课', weekday: 1, weeks: [1], start: '14:00', end: '15:00' }] };
  assert.equal(daily.nextCourse(data, new Date(2026,8,7,9,30)).ongoing, true);
  assert.equal(daily.nextCourse(data, new Date(2026,8,7,10,0)).title, '下午课');
  assert.equal(daily.nextCourse(data, new Date(2026,8,7,16,0)).date, '2026-09-14');
  assert.equal(daily.nextCourse(data, new Date(2026,8,15,16,0)), null);
});
test('ICS 精确教学周、UTC+8 时区、稳定 UID、转义与 UTF8 行折叠', () => {
  const data = { version: 1, semesterStart: '2026-09-07', courses: [{ title: '中文😀'.repeat(20) + ';,\nBEGIN:BAD', weekday: 1, weeks: [1, 3], start: '09:00', end: '10:00', room: 'A;B', teacher: '老师' }], attendance: [] };
  const first = ical.generate(data, '2026-09-01', '2026-09-30', new Date('2026-09-01T00:00:00Z'));
  const second = ical.generate(data, '2026-09-01', '2026-09-30');
  assert.equal(first.count, 2); assert.match(first.text, /DTSTART:20260907T010000Z/); assert.doesNotMatch(first.text, /20260914T/);
  assert.deepEqual(first.text.match(/UID:.+/g), second.text.match(/UID:.+/g));
  assert.ok(first.text.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  assert.doesNotMatch(first.text, /\r\nBEGIN:BAD/); assert.match(first.text.replace(/\r\n /g, ''), /\\nBEGIN:BAD/);
  assert.throws(() => ical.generate(data, '2026-01-01', '2028-01-01'));
});
test('年假页面新增、编辑取消，两个日历显示个人标记', () => {
  const p = page('leave'); p.onLoad({ date: '2026-09-14' }); p.onShow(); p.saveSettings({ detail: { value: { allowance: '5', openingUsed: '0' } } });
  p.add(); p.change({ currentTarget: { dataset: { field: 'stateIndex' } }, detail: { value: '2' } }); p.save({ detail: { value: { days: '1' } } });
  assert.equal(p.data.balance.remaining, 4);
  for (const name of ['attendance','schedule']) { const calendar = page(name); calendar.changeMonth({ detail: { value: '2026-09' } }); assert.equal(calendar.data.cells.find(c => c.date === '2026-09-14').personalMark, '假'); assert.equal(calendar.data.cells.find(c => c.date === '2026-09-20').holiday.badge, '班'); }
  p.edit({ currentTarget: { dataset: { id: p.data.rows[0].id } } }); p.change({ currentTarget: { dataset: { field: 'stateIndex' } }, detail: { value: '3' } }); p.save({ detail: { value: { days: '1' } } }); assert.equal(p.data.balance.remaining, 5);
});
test('考勤异常入口仅含已过日期且学校未达标，未同步不判缺勤', () => {
  store.saveSchoolSchedule(sample, true);
  store.saveSchoolMonth('2026-01', [{ date: '2026-01-05', minutes: 0, qualified: false }, { date: '2026-01-06', minutes: 0, qualified: null }, { date: '2026-01-07', minutes: 0, qualified: false, leave: true }]);
  const p = page('attendance'); p.changeMonth({ detail: { value: '2026-01' } }); assert.deepEqual(p.data.anomalies.map(a => a.date), ['2026-01-05']);
  p.changeMonth({ detail: { value: '2026-02' } }); assert.deepEqual(p.data.anomalies, []); assert.equal(p.data.monthStats.complete, false);
});
test('个人日程页面可添加、编辑、完成与恢复，标题在选择时间后保留', () => {
  const p = page('agenda'); p.onLoad({ date: '2026-09-22' }); p.onShow(); p.titleInput({ detail: { value: '测试组会' } });
  p.change({ currentTarget: { dataset: { field: 'timed' } }, detail: { value: true } });
  p.save({ detail: { value: { title: p.data.title } } });
  assert.equal(p.data.rows[0].date, '2026-09-22'); assert.equal(p.data.rows[0].time, '09:00');
  const e = { currentTarget: { dataset: { id: p.data.rows[0].id } } };
  p.toggle(e); assert.equal(p.data.rows.length, 0); p.filter(); assert.equal(p.data.rows[0].done, true);
  p.toggle(e); p.filter(); assert.equal(p.data.rows[0].done, false); p.edit(e); p.save({ detail: { value: { title: '测试更名' } } }); assert.equal(p.data.rows[0].title, '测试更名');
});
test('课表导出等待文件写完再分享，结束后清理，取消不是成功', async () => {
  store.saveSchoolSchedule(sample, true);
  wx.env = { USER_DATA_PATH: '/fixture' };
  let written = false, shared = 0, deleted = 0;
  wx.getFileSystemManager = () => ({ writeFile(opts) { assert.match(opts.data, /BEGIN:VCALENDAR/); written = true; opts.success(); }, unlinkSync() { deleted++; } });
  wx.shareFileMessage = opts => { assert.ok(written); shared++; opts.success(); };
  const p = page('calendar-export'); p.onLoad({ month: '2026-09' }); p.onShow(); await p.exportFile(); assert.equal(shared, 1); assert.equal(deleted, 1); assert.equal(p.data.status, '日历文件已导出');
  wx.shareFileMessage = opts => { opts.fail({ errMsg: 'shareFileMessage:fail cancel' }); };
  await p.exportFile(); assert.equal(p.data.status, '已取消导出'); assert.equal(p.data.busy, false); assert.equal(deleted, 2);
  wx.getFileSystemManager = () => ({ writeFile(opts) { opts.fail(); } }); await p.exportFile(); assert.match(p.data.status, /写入失败/); assert.equal(shared, 1);
});
