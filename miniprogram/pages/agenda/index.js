const planner = require('../../services/planner');
const d = require('../../utils/domain');
Page({
  data: { date: d.dateKey(), time: '09:00', timed: false, editing: false, title: '', rows: [], showDone: false, status: '' },
  onLoad(options = {}) { try { if (options.date) { d.parseDate(options.date); this.setData({ date: options.date, editing: true }); } } catch (_) {} },
  onShow() { this.render(); },
  render() {
    try { const rows = planner.read().events.filter(row => this.data.showDone ? row.done : !row.done).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)); this.setData({ rows, status: '' }); }
    catch (e) { this.setData({ status: e.message }); }
  },
  add() { this.setData({ editing: true, editId: '', title: '', date: d.dateKey(), time: '09:00', timed: false }); },
  edit(e) { const row = this.data.rows.find(r => r.id === e.currentTarget.dataset.id); if (row) this.setData({ editing: true, editId: row.id, title: row.title, date: row.date, time: row.time || '09:00', timed: !!row.time }); },
  cancel() { this.setData({ editing: false }); },
  titleInput(e) { this.setData({ title: e.detail.value }); },
  change(e) { const field = e.currentTarget.dataset.field; if (['date', 'time', 'timed'].includes(field)) this.setData({ [field]: e.detail.value }); },
  filter() { this.setData({ showDone: !this.data.showDone }); this.render(); },
  toggle(e) {
    try { const row = planner.read().events.find(r => r.id === e.currentTarget.dataset.id); if (row) planner.saveEvent({ ...row, done: !row.done }); this.render(); }
    catch (error) { this.setData({ status: error.message }); }
  },
  save(e) {
    try {
      const old = planner.read().events.find(r => r.id === this.data.editId);
      planner.saveEvent({ id: this.data.editId, title: e.detail.value.title, date: this.data.date, time: this.data.timed ? this.data.time : '', done: old ? old.done : false });
      this.setData({ editing: false }); this.render();
    } catch (error) { this.setData({ status: error.message }); }
  }
});
