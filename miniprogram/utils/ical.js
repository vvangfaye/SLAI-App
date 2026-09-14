const d = require('./domain');
function escape(value) { return String(value || '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,'); }
function hash(value) { let n = 2166136261; for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619); return (n >>> 0).toString(16); }
function stamp(date) { return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
function instant(date, time) {
  const [y, m, day] = date.split('-').map(Number), [h, minute] = time.split(':').map(Number);
  return stamp(new Date(Date.UTC(y, m - 1, day, h - 8, minute)));
}
function fold(line) {
  let output = '', bytes = 0;
  for (const char of line) {
    const code = char.codePointAt(0), size = code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
    if (bytes + size > 75) { output += '\r\n '; bytes = 1; }
    output += char; bytes += size;
  }
  return output;
}
function generate(input, start, end, now = new Date()) {
  const data = d.validate(input); d.parseDate(start); d.parseDate(end);
  if (start > end || Math.round((d.parseDate(end) - d.parseDate(start)) / 86400000) > 371) throw new Error('导出范围须在一年内');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hetao Daily//Course Calendar//ZH', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:河套日常课表', 'X-WR-TIMEZONE:Asia/Shanghai'];
  const seen = new Set(); let count = 0;
  for (let date = start; date <= end; date = d.addDays(date, 1)) {
    for (const course of d.coursesOn(data, date)) {
      const key = `${date}|${course.title}|${course.start}|${course.end}|${course.room}|${course.teacher}`;
      if (seen.has(key)) continue; seen.add(key); count++;
      lines.push('BEGIN:VEVENT', `UID:${date}-${hash(key)}@hetao-daily`, `DTSTAMP:${stamp(now)}`, `DTSTART:${instant(date, course.start)}`, `DTEND:${instant(date, course.end)}`, `SUMMARY:${escape(course.title)}`, `LOCATION:${escape(course.room)}`, `DESCRIPTION:${escape(course.teacher ? '教师：' + course.teacher : '')}`, 'END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return { count, text: lines.map(fold).join('\r\n') + '\r\n' };
}
module.exports = { generate };
