const { test } = require('node:test');
const assert = require('node:assert/strict');
const d = require('../miniprogram/utils/domain');
const sample = require('../examples/campus-data.json');
const fresh = () => JSON.parse(JSON.stringify(sample));

test('周次在周一递增，支持跨年与闰日', () => {
  assert.equal(d.weekNumber('2026-08-31', '2026-09-06'), 1);
  assert.equal(d.weekNumber('2026-08-31', '2026-09-07'), 2);
  assert.equal(d.monday('2027-01-01'), '2026-12-28');
  assert.equal(d.addDays('2024-02-28', 1), '2024-02-29');
  assert.throws(() => d.parseDate('2026-02-29'));
});
test('课程按教学周过滤，学期外不显示课程', () => {
  const data = d.validate(fresh());
  assert.equal(d.coursesOn(data, '2026-09-04').length, 1);
  assert.equal(d.coursesOn(data, '2026-09-11').length, 0);
  assert.equal(d.coursesOn(data, '2026-09-18').length, 1);
  assert.equal(d.coursesOn(data, '2026-08-24').length, 0);
});
test('不按时长推断学校判定', () => {
  const data = fresh(); data.attendance[0].minutes = 120; data.attendance[0].qualified = true;
  data.attendance[1].minutes = 600; data.attendance[1].qualified = false;
  assert.deepEqual(d.validate(data).attendance.map(a => a.qualified), [true, false, null]);
});
test('拒绝非法时间、教学周、日期、重复记录及负数时长', () => {
  for (const mutate of [
    s => { s.courses[0].start = '25:00'; },
    s => { s.courses[0].end = '08:00'; },
    s => { s.courses[0].weeks = [0]; },
    s => { s.courses[0].weekday = 8; },
    s => { s.semesterStart = '2026-09-01'; },
    s => { s.attendance[0].date = '2026-02-30'; },
    s => { s.attendance[1].date = s.attendance[0].date; },
    s => { s.attendance[0].minutes = -1; },
    s => { s.attendance[0].qualified = 'true'; }
  ]) { const data = fresh(); mutate(data); assert.throws(() => d.validate(data)); }
});
test('忽略凭据或额外字段，不持久化无关数据', () => {
  const data = fresh(); data.password = 'not-a-real-password'; data.courses[0].cookie = 'not-a-cookie';
  const clean = d.validate(data);
  assert.equal(clean.password, undefined); assert.equal(clean.courses[0].cookie, undefined);
});
