const d = require('../utils/domain');
function fail(message) { throw new Error(message); }
function clock(value) {
  const m = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/.exec(String(value || '').trim());
  return m && +m[1] < 24 ? m[1].padStart(2, '0') + ':' + m[2] : null;
}
function weeks(row) {
  const mask = Number(row.oldzc);
  if (Number.isSafeInteger(mask) && mask > 0) return Array.from({ length: 53 }, (_, i) => i + 1).filter(w => Math.floor(mask / 2 ** (w - 1)) % 2 === 1);
  const text = String(row.zcd || '').replace(/[，、]/g, ',').replace(/[－～~]/g, '-');
  const values = new Set();
  for (const part of text.split(',')) {
    const match = /^(?:第)?\s*(\d+)(?:\s*-\s*(\d+))?\s*周?(?:[（(][单双]周?[）)])?$/.exec(part.trim());
    if (!match) fail('课程教学周格式变化，未覆盖旧课表');
    const start = +match[1], end = +(match[2] || match[1]);
    if (start < 1 || end > 53 || end < start) fail('课程教学周超出范围');
    for (let w = start; w <= end; w++) if ((!part.includes('单') || w % 2 === 1) && (!part.includes('双') || w % 2 === 0)) values.add(w);
  }
  return [...values];
}
function schedule(semester, payload, periods, today = d.dateKey()) {
  const week = Number(semester.week);
  if (!Number.isInteger(week) || week < 1 || week > 53) fail('学校未提供有效当前教学周，无法确定课程日期');
  if (!payload || !Array.isArray(payload.kbList)) fail('课表格式变化，未覆盖旧课表');
  const table = {};
  (payload.sjkList || []).forEach(p => { const range = String(p.sj || '').split('-'); table[Number(p.sjk || p.sjbh)] = [clock(p.zcsj || range[0]), clock(p.jssj || range[1])]; });
  (periods || []).forEach((p, i) => { table[i + 1] = [clock(p.qssj), clock(p.jssj)]; });
  const courses = payload.kbList.map(row => {
    const range = /^(\d+)(?:-(\d+))?节?$/.exec(String(row.jcs || row.jcor || row.jc || '').trim());
    if (!range) fail('课程节次格式变化，未覆盖旧课表');
    const start = table[+range[1]], end = table[+(range[2] || range[1])];
    if (!start || !end || !start[0] || !end[1]) fail('学校未返回完整节次时间，无法准确显示课程');
    return { title: row.kcmc, weekday: Number(row.xqj), start: start[0], end: end[1], weeks: weeks(row), room: row.cdmc || '', teacher: row.xm || '' };
  });
  return d.validate({ version: 1, semesterStart: d.addDays(d.monday(today), -(week - 1) * 7), courses, attendance: [] });
}
function attendance(payload, month) {
  if (!payload || ![true, 'true'].includes(payload.success) || !Array.isArray(payload.weeks) || !payload.data || Array.isArray(payload.data) || typeof payload.data !== 'object') fail('考勤汇总格式变化，未覆盖旧记录');
  if (payload.weeks.some((_, i) => !Array.isArray(payload.data['week' + (i + 1)]))) fail('考勤周明细缺失，未覆盖旧记录');
  const byDate = new Map();
  for (const key of Object.keys(payload.data)) {
    if (!/^week\d+$/.test(key) || !Array.isArray(payload.data[key])) fail('考勤周明细格式变化');
    for (const row of payload.data[key]) {
      d.parseDate(row.date);
      if (!row.date.startsWith(month + '-')) continue;
      let minutes;
      if (row.duration !== undefined && row.duration !== null && row.duration !== '') {
        const seconds = Number(row.duration);
        if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) fail('考勤时长格式变化');
        minutes = Math.floor(seconds / 60);
      } else if (row.durationStr === '0' || row.durationStr === 0) {
        minutes = 0;
      } else {
        const m = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(String(row.durationStr || ''));
        if (!m) fail('考勤缺少有效时长，未将缺失值当作零');
        minutes = +m[1] * 60 + +m[2];
      }
      const q = row.isQual;
      const qualified = [true, 'true', '是', 1, '1'].includes(q) ? true : [false, 'false', '否', 0, '0'].includes(q) ? false : null;
      const record = { date: row.date, minutes, qualified };
      if ([true, 'true', '是', 1, '1'].includes(row.isLeave)) record.leave = true;
      else if ([false, 'false', '否', 0, '0'].includes(row.isLeave)) record.leave = false;
      if (byDate.has(row.date) && JSON.stringify(byDate.get(row.date)) !== JSON.stringify(record)) fail('考勤存在冲突日期，未覆盖旧记录');
      byDate.set(row.date, record);
    }
  }
  return d.validate({ version: 1, semesterStart: '2026-09-07', courses: [], attendance: [...byDate.values()] }).attendance;
}
module.exports = { schedule, attendance, weeks, summary: require('../utils/month-stats').parse };
