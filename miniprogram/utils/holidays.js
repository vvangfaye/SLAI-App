const d = require('./domain');
// 国办发明电〔2025〕7号，2026-09-13 核验。新年份必须经官方通知核验后添加。
const source = 'https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm';
const periods = [
  ['元旦', '2026-01-01', '2026-01-03'], ['春节', '2026-02-15', '2026-02-23'],
  ['清明节', '2026-04-04', '2026-04-06'], ['劳动节', '2026-05-01', '2026-05-05'],
  ['端午节', '2026-06-19', '2026-06-21'], ['中秋节', '2026-09-25', '2026-09-27'],
  ['国庆节', '2026-10-01', '2026-10-07']
];
const shifts = { '2026-01-04': '元旦', '2026-02-14': '春节', '2026-02-28': '春节', '2026-05-09': '劳动节', '2026-09-20': '国庆节', '2026-10-10': '国庆节' };
function supported(year) { return String(year) === '2026'; }
function info(date) {
  const weekday = d.parseDate(date).getDay();
  const known = supported(date.slice(0, 4));
  const period = periods.find(p => date >= p[1] && date <= p[2]);
  if (period) return { known, badge: '休', type: 'off', name: period[0], workday: false, detail: `${period[0]} · ${period[1].slice(5)} 至 ${period[2].slice(5)} 放假` };
  if (shifts[date]) return { known, badge: '班', type: 'work', name: shifts[date], workday: true, detail: `${shifts[date]}调休 · 补班` };
  return { known, badge: '', type: '', name: '', workday: known ? weekday !== 0 && weekday !== 6 : null, detail: known ? '' : '该年度节假日数据未收录' };
}
module.exports = { info, supported, source, periods };
