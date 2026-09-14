const d = require('./domain');
function updated(value) {
  const at = new Date(value);
  if (!value || !Number.isFinite(at.getTime())) return '';
  return `${d.dateKey(at).slice(5)} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}
function nextCourse(data, now = new Date()) {
  const today = d.dateKey(now), time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  for (let offset = 0; offset <= 371; offset++) {
    const date = d.addDays(today, offset);
    const course = d.coursesOn(data, date).find(c => offset !== 0 || c.end > time);
    if (course) return { ...course, date, ongoing: offset === 0 && course.start <= time, when: offset === 0 ? '今天' : offset === 1 ? '明天' : date.slice(5) };
  }
  return null;
}
module.exports = { updated, nextCourse };
