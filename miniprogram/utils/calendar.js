const d = require('./domain');
const holidays = require('./holidays');
function shiftMonth(month, offset) {
  d.parseDate(month + '-01');
  const [year, number] = month.split('-').map(Number);
  return d.dateKey(new Date(year, number - 1 + offset, 1, 12)).slice(0, 7);
}
function monthCells(month, records, today = d.dateKey()) {
  const first = month + '-01'; const start = d.monday(first);
  const next = shiftMonth(month, 1) + '-01';
  const last = d.addDays(next, -1);
  const count = Math.ceil((Math.round((d.parseDate(last) - d.parseDate(start)) / 86400000) + 1) / 7) * 7;
  const byDate = new Map(records.map(row => [row.date, row]));
  return Array.from({ length: count }, (_, i) => {
    const date = d.addDays(start, i), record = byDate.get(date);
    const inMonth = date.startsWith(month + '-'), future = date > today;
    const state = record ? record.qualified === true ? 'qualified' : record.qualified === false ? 'unqualified' : 'pending' : 'none';
    return { date, day: Number(date.slice(-2)), inMonth, today: date === today, future, state, holiday: holidays.info(date),
      caption: record ? `${Math.floor(record.minutes / 60)}h${record.minutes % 60 ? String(record.minutes % 60).padStart(2,'0') : ''}` : future ? '' : '—' };
  });
}
module.exports = { monthCells, shiftMonth };
