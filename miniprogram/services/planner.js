const d = require('../utils/domain');
const holidays = require('../utils/holidays');
const KEY = 'hetao.personal-planner.v1';
const rules = ['manual', 'workday', 'calendar'];
const states = ['planned', 'pending', 'approved', 'cancelled'];
const stateNames = { planned: '计划', pending: '待审批', approved: '已批准', cancelled: '已取消' };
function fail(message) { throw new Error(message); }
function half(value, label) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') fail(`请填写${label}`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 366 || !Number.isInteger(n * 2)) fail(`${label}须为 0.5 天的倍数`);
  return n;
}
function yearKey(year) { if (!/^20\d{2}$/.test(String(year))) fail('年份须在 2000 至 2099 年'); return String(year); }
function config(value = {}) {
  return { allowance: value.allowance === null || value.allowance === undefined ? null : half(value.allowance, '年假额度'), openingUsed: half(value.openingUsed === undefined ? 0 : value.openingUsed, '此前已用'), rule: rules.includes(value.rule) ? value.rule : 'manual' };
}
function range(input) {
  d.parseDate(input.start); d.parseDate(input.end);
  if (input.start > input.end) fail('结束日期不能早于开始日期');
  if (input.start.slice(0, 4) !== input.end.slice(0, 4)) fail('跨年请假请按年度分开记录');
  yearKey(input.start.slice(0, 4));
  const startHalf = Number(input.startHalf), endHalf = Number(input.endHalf);
  if (![0, 1].includes(startHalf) || ![0, 1].includes(endHalf) || (input.start === input.end && startHalf > endHalf)) fail('请检查上午、下午的选择');
  const days = [];
  for (let date = input.start; date <= input.end; date = d.addDays(date, 1)) {
    days.push({ date, from: date === input.start ? startHalf : 0, to: date === input.end ? endHalf : 1 });
  }
  return days;
}
function estimate(input, rule, courses) {
  const days = range(input);
  if (!rules.includes(rule)) fail('请选择扣假规则');
  if (rule === 'workday' && days.some(day => !holidays.info(day.date).known)) fail('该年度节假日未收录，请改为手动填写');
  const span = days.reduce((n, day) => n + (day.to - day.from + 1) / 2, 0);
  const charge = rule === 'manual' ? null : days.reduce((n, day) => n + (rule === 'calendar' || holidays.info(day.date).workday ? (day.to - day.from + 1) / 2 : 0), 0);
  const conflicts = courses ? days.flatMap(day => d.coursesOn(courses, day.date).filter(c => (day.from === 0 || c.end > '12:00') && (day.to === 1 || c.start < '12:00')).map(c => ({ date: day.date, title: c.title, start: c.start }))) : [];
  return { span, charge, conflicts };
}
function leave(input) {
  range(input);
  const days = half(input.days, '扣假天数');
  if (days <= 0 || days > estimate(input, 'calendar').span) fail('扣假天数须大于 0，且不超过所选时段');
  if (!states.includes(input.status) || !['annual', 'other'].includes(input.kind)) fail('请假类型或状态有误');
  if (typeof input.id !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(input.id)) fail('记录编号有误');
  return { id: input.id, start: input.start, end: input.end, startHalf: Number(input.startHalf), endHalf: Number(input.endHalf), days, kind: input.kind, status: input.status };
}
function event(input) {
  d.parseDate(input.date); yearKey(input.date.slice(0, 4));
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 80) fail('日程标题须为 1 至 80 个字');
  if (input.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) fail('时间格式有误');
  if (typeof input.id !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(input.id)) fail('记录编号有误');
  return { id: input.id, title: input.title.trim(), date: input.date, time: input.time || '', done: input.done === true };
}
function read() {
  const saved = wx.getStorageSync(KEY);
  if (!saved) return { version: 1, years: {}, leaves: [], events: [] };
  try {
    if (saved.version !== 1 || !saved.years || !Array.isArray(saved.leaves) || !Array.isArray(saved.events) || saved.leaves.length > 2000 || saved.events.length > 2000) fail('数据格式错误');
    const years = {};
    Object.keys(saved.years).forEach(y => { years[yearKey(y)] = config(saved.years[y]); });
    return { version: 1, years, leaves: saved.leaves.map(leave), events: saved.events.map(event) };
  } catch (_) { fail('个人记录读取失败，未覆盖原数据'); }
}
function write(data) { wx.setStorageSync(KEY, data); }
function id() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
function saveConfig(year, input) { const data = read(); data.years[yearKey(year)] = config(input); write(data); }
function overlap(a, b) {
  return `${a.start}-${a.startHalf}` <= `${b.end}-${b.endHalf}` && `${b.start}-${b.startHalf}` <= `${a.end}-${a.endHalf}`;
}
function saveLeave(input) {
  const data = read(), row = leave({ ...input, id: input.id || id() });
  if (row.status !== 'cancelled' && data.leaves.some(old => old.id !== row.id && old.status !== 'cancelled' && overlap(old, row))) fail('该时段已有请假记录，请编辑原记录');
  if (!data.leaves.some(old => old.id === row.id) && data.leaves.length >= 2000) fail('请假记录已达上限');
  data.leaves = [...data.leaves.filter(old => old.id !== row.id), row]; write(data); return row;
}
function saveEvent(input) {
  const data = read(), row = event({ ...input, id: input.id || id() });
  if (!data.events.some(old => old.id === row.id) && data.events.length >= 2000) fail('个人日程已达上限');
  data.events = [...data.events.filter(old => old.id !== row.id), row]; write(data); return row;
}
function balance(data, year) {
  const settings = config(data.years[yearKey(year)]);
  const rows = data.leaves.filter(row => row.kind === 'annual' && row.start.startsWith(String(year)));
  const approved = rows.filter(row => row.status === 'approved').reduce((n, row) => n + row.days, 0);
  const pending = rows.filter(row => row.status === 'pending').reduce((n, row) => n + row.days, 0);
  const remaining = settings.allowance === null ? null : settings.allowance - settings.openingUsed - approved;
  return { ...settings, approved, pending, remaining, available: remaining === null ? null : remaining - pending };
}
function onDate(data, date) {
  return { leaves: data.leaves.filter(row => row.status !== 'cancelled' && date >= row.start && date <= row.end).map(row => ({ ...row, kindName: row.kind === 'annual' ? '年假' : '其他请假', stateName: stateNames[row.status] })), events: data.events.filter(row => row.date === date && !row.done).sort((a, b) => a.time.localeCompare(b.time)) };
}
function decorate(cells, data) { return cells.map(cell => { const day = onDate(data, cell.date); return { ...cell, personalMark: day.leaves.length ? '假' : day.events.length ? '事' : '' }; }); }
module.exports = { read, config, saveConfig, saveLeave, saveEvent, balance, estimate, onDate, decorate, states, stateNames, rules };
