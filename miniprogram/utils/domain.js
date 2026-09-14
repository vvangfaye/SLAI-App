const DAY = 86400000;
const pad = n => String(n).padStart(2, '0');
function dateKey(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('日期请使用 YYYY-MM-DD');
  const [y, m, d] = s.split('-').map(Number);
  const value = new Date(y, m - 1, d, 12);
  if (dateKey(value) !== s) throw new Error('日期不存在');
  return value;
}
function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return dateKey(d); }
function monday(s) { const d = parseDate(s); return addDays(s, -((d.getDay() + 6) % 7)); }
function weekNumber(start, day) { return Math.floor(Math.round((parseDate(day) - parseDate(start)) / DAY) / 7) + 1; }
function duration(minutes) { return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`; }
function coursesOn(data, day) {
  const week = weekNumber(data.semesterStart, day);
  const weekday = (parseDate(day).getDay() + 6) % 7 + 1;
  return data.courses.filter(c => c.weekday === weekday && c.weeks.includes(week)).sort((a, b) => a.start.localeCompare(b.start));
}
function validate(input) {
  if (!input || input.version !== 1) throw new Error('数据版本必须是 version: 1');
  parseDate(input.semesterStart);
  if (parseDate(input.semesterStart).getDay() !== 1) throw new Error('学期起始日必须是第 1 周的周一');
  if (!Array.isArray(input.courses) || !Array.isArray(input.attendance)) throw new Error('缺少 courses 或 attendance 数组');
  if (input.courses.length > 500 || input.attendance.length > 1000) throw new Error('数据量超过限制');
  const time = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const str = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
  const courses = input.courses.map((c, i) => {
    if (!c || !str(c.title, 100) || !Number.isInteger(c.weekday) || c.weekday < 1 || c.weekday > 7 || !time(c.start) || !time(c.end) || c.start >= c.end || !Array.isArray(c.weeks) || !c.weeks.length || c.weeks.length > 53 || c.weeks.some(w => !Number.isInteger(w) || w < 1 || w > 53)) throw new Error(`第 ${i + 1} 门课程的名称、时间或教学周有误`);
    return { id: `c${i}`, title: c.title.trim(), weekday: c.weekday, start: c.start, end: c.end, weeks: [...new Set(c.weeks)], room: typeof c.room === 'string' ? c.room.slice(0, 100) : '', teacher: typeof c.teacher === 'string' ? c.teacher.slice(0, 100) : '' };
  });
  const seen = new Set();
  const attendance = input.attendance.map((a, i) => {
    if (!a) throw new Error(`第 ${i + 1} 条考勤格式有误`);
    parseDate(a.date);
    if (seen.has(a.date)) throw new Error('考勤日期重复');
    seen.add(a.date);
    if (!Number.isInteger(a.minutes) || a.minutes < 0 || a.minutes > 1440 || ![true, false, null].includes(a.qualified)) throw new Error(`第 ${i + 1} 条考勤时长或学校判定有误`);
    return { date: a.date, minutes: a.minutes, qualified: a.qualified, ...(typeof a.leave === 'boolean' ? { leave: a.leave } : {}) };
  });
  return { version: 1, semesterStart: input.semesterStart, courses, attendance };
}
module.exports = { dateKey, parseDate, addDays, monday, weekNumber, duration, coursesOn, validate };
