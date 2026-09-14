const campus = require('../../services/campus');
const store = require('../../services/store');
const d = require('../../utils/domain');
const calendar = require('../../utils/calendar');
const dayView = require('../../services/day-view');
const stats = require('../../utils/month-stats');
const daily = require('../../utils/daily');
Page({
  data: { weekdays: ['一', '二', '三', '四', '五', '六', '日'], selectedDate: d.dateKey(), month: d.dateKey().slice(0, 7), expanded: '', punches: [], punchStatus: '', punchLoading: false },
  onShow() { this.requestVersion = (this.requestVersion || 0) + 1; this.setData({ expanded: '', punches: [], punchStatus: '', punchLoading: false }); this.render(); },
  onHide() { this.requestVersion = (this.requestVersion || 0) + 1; },
  onUnload() { this.requestVersion = (this.requestVersion || 0) + 1; },
  prevMonth() { this.changeMonth({ detail: { value: calendar.shiftMonth(this.data.month, -1) } }); },
  nextMonth() { this.changeMonth({ detail: { value: calendar.shiftMonth(this.data.month, 1) } }); },
  today() { this.changeMonth({ detail: { value: d.dateKey().slice(0, 7) } }); },
  async selectDay(e) {
    const date = e.currentTarget.dataset.date;
    if (!date || !date.startsWith(this.data.month + '-')) return;
    this.setData({ selectedDate: date }); this.render();
    if (this.data.expanded !== date) await this.toggleDay(e);
  },
  async refreshPunches() { this.setData({ expanded: '' }); await this.toggleDay({ currentTarget: { dataset: { date: this.data.selectedDate } } }); },
  changeMonth(e) { this.requestVersion = (this.requestVersion || 0) + 1; this.setData({ month: e.detail.value, selectedDate: e.detail.value === d.dateKey().slice(0, 7) ? d.dateKey() : e.detail.value + '-01', expanded: '', punches: [], punchLoading: false }); this.render(); },
  async toggleDay(e) {
    const date = e.currentTarget.dataset.date;
    const version = this.requestVersion = (this.requestVersion || 0) + 1;
    if (this.data.expanded === date) { this.setData({ expanded: '', punches: [], punchLoading: false }); return; }
    this.setData({ expanded: date, punches: [], punchStatus: '', punchLoading: true });
    if (date > d.dateKey()) { this.setData({ punchLoading: false, punchStatus: '这一天还没到来' }); return; }
    if (store.read().source !== 'school') { this.setData({ punchLoading: false, punchStatus: '登录并同步后可查看打卡记录。' }); return; }
    try { const punches = await campus.punches(date); if (version === this.requestVersion) this.setData({ punches, punchStatus: punches.length ? '' : '学校未返回该日打卡记录' }); }
    catch (e) { if (version === this.requestVersion) this.setData({ punchStatus: e.message }); }
    finally { if (version === this.requestVersion) this.setData({ punchLoading: false }); }
  },
  async syncMonth() {
    if (this.data.busy) return;
    await campus.ready();
    if (this.data.busy) return;
    if (!campus.connected() && !campus.remembered()) { wx.navigateTo({ url: '/pages/login/index?month=' + this.data.month }); return; }
    const month = this.data.month;
    this.requestVersion = (this.requestVersion || 0) + 1;
    this.setData({ expanded: '', punches: [], punchLoading: false, busy: true, status: '正在同步 ' + month + '…' });
    try { await campus.sync({ month, monthOnly: true }); this.setData({ status: month + ' 考勤同步完成' }); }
    catch (e) { this.setData({ status: e.message }); }
    finally { this.setData({ busy: false }); this.render(); }
  },
  render() {
    const data = store.read(); const target = store.prefs().target;
    const rows = data.attendance.filter(a => a.date.startsWith(this.data.month)).sort((a, b) => b.date.localeCompare(a.date)).map(a => ({ ...a, duration: d.duration(a.minutes), progress: Math.min(100, Math.round(a.minutes / (target * 60) * 100)), status: a.qualified === null ? '待判定' : a.qualified ? '合格' : '未达标' }));
    const selected = rows.find(row => row.date === this.data.selectedDate) || null;
    const selectedDate = this.data.selectedDate;
    this.setData({ ...dayView.view(calendar.monthCells(this.data.month, rows).map(cell => ({ ...cell, schoolLeave: rows.some(row => row.date === cell.date && row.leave === true) })), selectedDate), monthStats: stats.view(data.summaries && data.summaries[this.data.month]), anomalies: rows.filter(row => row.date < d.dateKey() && row.qualified === false && row.leave !== true) });
    this.setData({ monthTitle: Number(this.data.month.slice(5)) + ' 月', yearTitle: this.data.month.slice(0,4), selected, selectedTitle: Number(selectedDate.slice(5,7)) + ' 月 ' + Number(selectedDate.slice(8)) + ' 日', selectedFuture: selectedDate > d.dateKey(), isCurrentMonth: selectedDate.slice(0,7) === d.dateKey().slice(0,7), recorded: rows.length, totalHours: Math.floor(rows.reduce((n,a) => n + a.minutes, 0) / 60), cached: data.source === 'school' && !!data.months[this.data.month], monthSavedAt: daily.updated(data.months && data.months[this.data.month]), rows, target, label: store.sourceLabel(data), qualified: rows.filter(a => a.qualified === true).length, total: d.duration(rows.reduce((n, a) => n + a.minutes, 0)) });
  },
  showAnomalies() { this.setData({ anomaliesOpen: !this.data.anomaliesOpen }); },
  openLeave() { wx.navigateTo({ url: '/pages/leave/index?date=' + this.data.selectedDate }); },
  openAgenda() { wx.navigateTo({ url: '/pages/agenda/index?date=' + this.data.selectedDate }); }
});
