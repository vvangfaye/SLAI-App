const d = require('../utils/domain');
const { estimate } = require('../utils/live-attendance');
const store = require('./store');
function timeLabel(now) { return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`; }

// Shared by home and today's detail. Snapshots and timers live only for the visible page.
module.exports = {
  resetLiveAttendance() { this.liveSnapshot = null; this.setData({ live: null }); },
  beginLiveAttendance(date) { this.liveRequestedDate = date; this.liveAttemptAt = Date.now(); },
  acceptLiveAttendance(date, punches) {
    if (date !== d.dateKey()) { this.resetLiveAttendance(); return; }
    this.liveSnapshot = { date, punches, at: new Date(), failed: false };
    this.renderLiveAttendance();
  },
  failLiveAttendance() {
    if (this.liveSnapshot) { this.liveSnapshot.failed = true; this.renderLiveAttendance(); }
  },
  renderLiveAttendance(now = new Date()) {
    const snapshot = this.liveSnapshot;
    if (!snapshot || snapshot.date !== d.dateKey(now) || (this.data.selectedDate && this.data.selectedDate !== snapshot.date)) { this.setData({ live: null }); return; }
    const live = estimate(snapshot.punches, snapshot.date, snapshot.failed ? snapshot.at : now, store.prefs().target);
    live.updated = timeLabel(snapshot.at);
    live.stale = snapshot.failed;
    if (snapshot.failed) {
      live.status = '待更新';
      live.hint = `刷新失败，显示 ${live.updated} 的估算时长`;
      live.targetText = '';
      live.sessions = live.sessions.map(session => session.ongoing ? { ...session, end: live.updated, ongoing: false } : session);
    }
    this.setData({ live });
  },
  startAttendanceClock() {
    this.stopAttendanceClock();
    this.attendanceDay = d.dateKey();
    this.attendanceTimer = setInterval(() => this.tickAttendance(), 15000);
    // Node page tests should not stay alive for a UI timer.
    if (this.attendanceTimer && this.attendanceTimer.unref) this.attendanceTimer.unref();
  },
  stopAttendanceClock() { if (this.attendanceTimer) clearInterval(this.attendanceTimer); this.attendanceTimer = null; },
  tickAttendance() {
    if (this.hidden || this.gone) return;
    const today = d.dateKey();
    if (today !== this.attendanceDay) {
      const previousDay = this.attendanceDay;
      this.attendanceDay = today;
      this.resetLiveAttendance();
      this.rolloverAttendance(previousDay);
      return;
    }
    this.renderLiveAttendance();
    if (this.liveRequestedDate === today && (!this.data.selectedDate || this.data.selectedDate === today) && !this.data.needsLogin && !this.data.punchLoading && !this.data.syncing && !this.data.busy && Date.now() - this.liveAttemptAt >= 60000) this.refreshPunches();
  }
};
