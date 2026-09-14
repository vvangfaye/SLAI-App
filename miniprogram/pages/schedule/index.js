const store = require('../../services/store');
const d = require('../../utils/domain');
const calendar = require('../../utils/calendar');
const dayView = require('../../services/day-view');
const daily = require('../../utils/daily');
Page({
  data: { month: d.dateKey().slice(0,7), selectedDate: d.dateKey(), weekdays: ['一','二','三','四','五','六','日'] },
  onShow() { this.render(); },
  changeMonth(e) {
    const month = e.detail.value;
    this.setData({ month, selectedDate: month === d.dateKey().slice(0,7) ? d.dateKey() : month + '-01' });
    this.render();
  },
  prev() { this.changeMonth({ detail: { value: calendar.shiftMonth(this.data.month, -1) } }); },
  next() { this.changeMonth({ detail: { value: calendar.shiftMonth(this.data.month, 1) } }); },
  current() { this.changeMonth({ detail: { value: d.dateKey().slice(0,7) } }); },
  selectDay(e) {
    const date = e.currentTarget.dataset.date;
    if (!date || !date.startsWith(this.data.month + '-')) return;
    this.setData({ selectedDate: date }); this.render();
  },
  render() {
    const data = store.read();
    const cells = calendar.monthCells(this.data.month, []).map(cell => {
      const count = cell.inMonth ? d.coursesOn(data, cell.date).length : 0;
      return { ...cell, count, schoolLeave: data.attendance.some(row => row.date === cell.date && row.leave === true), caption: cell.inMonth ? count ? `${count} 门课` : '—' : '' };
    });
    const date = this.data.selectedDate;
    const week = d.weekNumber(data.semesterStart, date);
    const courses = d.coursesOn(data, date);
    this.setData({ ...dayView.view(cells, date), courses, schoolLeave: data.attendance.some(row => row.date === date && row.leave === true), updatedAt: daily.updated(data.savedAt), label: store.sourceLabel(data), yearTitle: this.data.month.slice(0,4), monthTitle: Number(this.data.month.slice(5)) + ' 月',
      count: cells.reduce((n,c) => n + c.count, 0), classDays: cells.filter(c => c.count > 0).length,
      selectedTitle: Number(date.slice(5,7)) + ' 月 ' + Number(date.slice(8)) + ' 日', selectedWeekday: ['周日','周一','周二','周三','周四','周五','周六'][d.parseDate(date).getDay()],
      weekLabel: week < 1 ? '学期未开始' : '第 ' + week + ' 教学周', isToday: date === d.dateKey() });
  },
  openLeave() { wx.navigateTo({ url: '/pages/leave/index?date=' + this.data.selectedDate }); },
  openAgenda() { wx.navigateTo({ url: '/pages/agenda/index?date=' + this.data.selectedDate }); },
  exportCalendar() { wx.navigateTo({ url: '/pages/calendar-export/index?month=' + this.data.month }); }
});
