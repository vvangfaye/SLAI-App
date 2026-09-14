const campus = require('../../services/campus');
const store = require('../../services/store');
const d = require('../../utils/domain');
const planner = require('../../services/planner');
const stats = require('../../utils/month-stats');
const daily = require('../../utils/daily');
const holidays = require('../../utils/holidays');
Page({
  data: { syncing: false, syncStatus: '', punches: [], punchLoading: false, punchStatus: '', needsLogin: false },
  onHide() { this.hidden = true; this.punchVersion = (this.punchVersion || 0) + 1; },
  onUnload() { this.gone = true; this.onHide(); },
  async sync() {
    if (this.data.syncing) return;
    await campus.ready();
    if (this.data.syncing || this.gone || this.hidden) return;
    if (!campus.connected() && !campus.remembered()) { this.login(); return; }
    this.punchVersion = (this.punchVersion || 0) + 1;
    this.setData({ syncing: true, syncStatus: '正在同步…', punches: [], punchLoading: false });
    try { await campus.sync({ progress: syncStatus => { if (!this.gone) this.setData({ syncStatus }); } }); }
    catch (e) { if (!this.gone) this.setData({ syncStatus: e.message }); }
    finally { if (!this.gone) { this.setData({ syncing: false }); if (!this.hidden) { this.render(); this.refreshPunches(); } } }
  },
  onShow() { this.hidden = false; this.render(); return this.refreshPunches(); },
  render() {
    const data = store.read(); const prefs = store.prefs(); const today = d.dateKey();
    const record = data.attendance.find(a => a.date === today);
    const minutes = record ? record.minutes : 0;
    const month = today.slice(0, 7);
    let leaveBalance = null, nextEvents = [], personalError = '';
    try { const personal = planner.read(); leaveBalance = planner.balance(personal, today.slice(0, 4)); nextEvents = personal.events.filter(e => !e.done && e.date >= today && e.date <= d.addDays(today, 7)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 2); }
    catch (e) { personalError = e.message; }
    this.setData({ leaveBalance, nextEvents, personalError, monthStats: stats.view(data.summaries && data.summaries[month]), nextCourse: daily.nextCourse(data), holiday: holidays.info(today), attendanceUpdated: daily.updated(data.months && data.months[month]), courseUpdated: daily.updated(data.savedAt) });
    this.setData({ label: store.sourceLabel(data), date: today.replace(/-/g, '.'), week: d.weekNumber(data.semesterStart, today), courses: d.coursesOn(data, today), showCourses: prefs.showCourses, hasRecord: !!record, hours: Math.floor(minutes / 60), minutes: minutes % 60, progress: Math.min(100, Math.round(minutes / (prefs.target * 60) * 100)), target: prefs.target, qualification: record ? record.qualified === null ? '待判定' : record.qualified ? '合格' : '未达标' : '暂无今日记录' });
  },
  async refreshPunches() {
    if (this.data.syncing || this.gone || this.hidden) return;
    const version = this.punchVersion = (this.punchVersion || 0) + 1;
    const date = d.dateKey();
    await campus.ready();
    if (version !== this.punchVersion || this.hidden || this.gone) return;
    const needsLogin = (!campus.connected() && !campus.remembered()) || store.read().source !== 'school';
    this.setData({ punches: [], punchLoading: !needsLogin, needsLogin, punchStatus: needsLogin ? '登录后查看' : '' });
    if (needsLogin) return;
    try {
      const punches = await campus.punches(date);
      if (version === this.punchVersion && date === d.dateKey()) this.setData({ punches, punchStatus: punches.length ? '' : '今日暂无打卡' });
    } catch (e) {
      if (version === this.punchVersion) this.setData({ punchStatus: e.message, needsLogin: !campus.connected() && !campus.remembered() });
    } finally {
      if (version === this.punchVersion) this.setData({ punchLoading: false });
    }
  },
  openSchedule() { wx.switchTab({ url: '/pages/schedule/index' }); },
  openAttendance() { wx.switchTab({ url: '/pages/attendance/index' }); },
  openLeave() { wx.navigateTo({ url: '/pages/leave/index' }); },
  openAgenda() { wx.navigateTo({ url: '/pages/agenda/index' }); },
  login() { wx.navigateTo({ url: '/pages/login/index' }); },
});
