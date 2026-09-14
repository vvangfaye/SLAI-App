const d = require('../utils/domain');
const KEY = 'slaier.data.v1';
const PREFS = 'slaier.prefs.v1';
const stats = require('../utils/month-stats');
function summaries(saved) {
  const result = {};
  if (saved.source === 'school' && saved.summaries && typeof saved.summaries === 'object') Object.keys(saved.summaries).filter(m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m)).forEach(m => { result[m] = stats.clean(saved.summaries[m]); });
  return result;
}
function demo() {
  const today = d.dateKey();
  const start = d.addDays(d.monday(today), -14);
  const titles = ['机器学习', '最优化理论与方法', '大模型基础', '学术英语', '强化学习', '科研讨论班'];
  const courses = titles.map((title, i) => ({ title, weekday: i % 5 + 1, start: i === 5 ? '14:00' : '09:30', end: i === 5 ? '15:35' : '11:05', weeks: Array.from({ length: 18 }, (_, j) => j + 1), room: `教学楼 ${301 + i}`, teacher: '演示教师' }));
  const attendance = Array.from({ length: 10 }, (_, i) => ({ date: d.addDays(today, -i), minutes: i === 0 ? 255 : 290 + (i * 47) % 240, qualified: i === 0 ? null : i % 4 !== 0 }));
  return { ...d.validate({ version: 1, semesterStart: start, courses, attendance }), source: 'demo', savedAt: '' };
}
function read() {
  const saved = wx.getStorageSync(KEY);
  if (!saved) return demo();
  try { return { ...d.validate(saved), source: saved.source === 'school' ? 'school' : 'import', months: saved.source === 'school' && saved.months && typeof saved.months === 'object' ? saved.months : {}, summaries: summaries(saved), savedAt: typeof saved.savedAt === 'string' ? saved.savedAt : '' }; }
  catch (_) { return { version: 1, semesterStart: d.monday(d.dateKey()), courses: [], attendance: [], source: 'error', savedAt: '' }; }
}
function saveSchoolSchedule(input, fresh) {
  const old = read();
  const keep = !fresh && old.source === 'school';
  const clean = d.validate({ ...input, attendance: keep ? old.attendance : [] });
  wx.setStorageSync(KEY, { ...clean, source: 'school', months: keep ? old.months : {}, summaries: keep ? old.summaries : {}, savedAt: new Date().toISOString() });
}
function saveSchoolMonth(month, rows, summary) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || rows.some(row => !row.date || !row.date.startsWith(month + '-'))) throw new Error('考勤月份有误');
  const old = read();
  if (old.source !== 'school') throw new Error('校园数据已切换，请重新登录');
  const clean = d.validate({ ...old, attendance: [...old.attendance.filter(a => !a.date.startsWith(month + '-')), ...rows] });
  wx.setStorageSync(KEY, { ...clean, source: 'school', months: { ...old.months, [month]: new Date().toISOString() }, summaries: { ...old.summaries, [month]: stats.clean(summary) }, savedAt: old.savedAt });
}
function prefs() {
  const p = wx.getStorageSync(PREFS) || {};
  return { target: Number.isInteger(p.target) && p.target >= 1 && p.target <= 24 ? p.target : 6, showCourses: p.showCourses !== false };
}
function setPrefs(p) { wx.setStorageSync(PREFS, p); }
function clear() { wx.removeStorageSync(KEY); }
function sourceLabel(data) { return data.source === 'school' ? '学校数据 · 已缓存' : data.source === 'demo' ? '演示数据' : data.source === 'error' ? '缓存异常，请重新同步' : '本地缓存'; }
module.exports = { read, prefs, setPrefs, clear, demo, sourceLabel, saveSchoolSchedule, saveSchoolMonth };
