const planner = require('../../services/planner');
const store = require('../../services/store');
const d = require('../../utils/domain');
Page({
  data: { year: d.dateKey().slice(0, 4), editing: false, settingsOpen: false, status: '', rules: ['手动填写实际扣假', '按调休工作日估算', '按日历天估算'], ruleIndex: 0, halves: ['上午', '下午'], kinds: ['年假', '其他请假'], stateNames: ['计划', '待审批', '已批准', '已取消'], start: d.dateKey(), end: d.dateKey(), startHalf: 0, endHalf: 1, kindIndex: 0, stateIndex: 0, days: '', conflicts: [] },
  onLoad(options = {}) {
    try { if (options.date) { d.parseDate(options.date); this.setData({ year: options.date.slice(0, 4), start: options.date, end: options.date }); } } catch (_) {}
  },
  onShow() { this.render(); },
  render() {
    try {
      const data = planner.read(), balance = planner.balance(data, this.data.year);
      const rows = data.leaves.filter(row => row.start.startsWith(this.data.year)).sort((a, b) => b.start.localeCompare(a.start)).map(row => ({ ...row, kindName: row.kind === 'annual' ? '年假' : '其他', stateName: planner.stateNames[row.status], range: `${row.start.slice(5)} ${row.startHalf ? '下午' : '上午'} — ${row.end.slice(5)} ${row.endHalf ? '下午' : '上午'}` }));
      this.setData({ balance, rows, allowance: balance.allowance === null ? '' : String(balance.allowance), openingUsed: String(balance.openingUsed), ruleIndex: planner.rules.indexOf(balance.rule), settingsOpen: this.data.settingsOpen || balance.allowance === null, status: '' });
    } catch (e) { this.setData({ status: e.message }); }
  },
  changeYear(e) { this.setData({ year: e.detail.value.slice(0, 4), editing: false, settingsOpen: false }); this.render(); },
  settings() { this.setData({ settingsOpen: !this.data.settingsOpen }); },
  ruleChange(e) { this.setData({ ruleIndex: Number(e.detail.value) }); },
  fieldInput(e) { const field = e.currentTarget.dataset.field; if (['days', 'allowance', 'openingUsed'].includes(field)) this.setData({ [field]: e.detail.value }); },
  saveSettings(e) {
    try {
      const value = e.detail.value;
      planner.saveConfig(this.data.year, { allowance: value.allowance, openingUsed: value.openingUsed || 0, rule: planner.rules[this.data.ruleIndex] });
      this.setData({ settingsOpen: false }); this.render(); this.preview(); wx.showToast({ title: '已保存', icon: 'success' });
    } catch (error) { this.setData({ status: error.message }); }
  },
  add() {
    const date = this.data.start.startsWith(this.data.year) ? this.data.start : this.data.year + '-01-01';
    this.setData({ editing: true, editId: '', start: date, end: date, startHalf: 0, endHalf: 1, kindIndex: 0, stateIndex: 0, days: '', status: '' }); this.preview();
  },
  edit(e) {
    const row = (this.data.rows || []).find(item => item.id === e.currentTarget.dataset.id); if (!row) return;
    this.setData({ editing: true, editId: row.id, start: row.start, end: row.end, startHalf: row.startHalf, endHalf: row.endHalf, kindIndex: row.kind === 'annual' ? 0 : 1, stateIndex: planner.states.indexOf(row.status), days: String(row.days), status: '' }); this.preview();
  },
  cancelEdit() { this.setData({ editing: false, status: '' }); },
  change(e) {
    const key = e.currentTarget.dataset.field;
    if (!['start', 'end', 'startHalf', 'endHalf', 'kindIndex', 'stateIndex'].includes(key)) return;
    const value = ['start', 'end'].includes(key) ? e.detail.value : Number(e.detail.value);
    this.setData({ [key]: value });
    if (key === 'start' && this.data.end < value) this.setData({ end: value });
    this.preview();
  },
  preview() {
    if (!this.data.editing) return;
    try {
      const rule = planner.balance(planner.read(), this.data.year).rule;
      const plan = planner.estimate(this.data, rule, store.read());
      this.setData({ span: plan.span, estimated: plan.charge, conflicts: plan.conflicts.slice(0, 5), conflictCount: plan.conflicts.length, estimateError: '' });
    } catch (e) { this.setData({ estimated: null, conflicts: [], conflictCount: 0, estimateError: e.message }); }
  },
  useEstimate() { if (this.data.estimated !== null && this.data.estimated !== undefined) this.setData({ days: String(this.data.estimated) }); },
  save(e) {
    try {
      planner.saveLeave({ id: this.data.editId, start: this.data.start, end: this.data.end, startHalf: this.data.startHalf, endHalf: this.data.endHalf, days: e.detail.value.days, kind: this.data.kindIndex === 0 ? 'annual' : 'other', status: planner.states[this.data.stateIndex] });
      this.setData({ year: this.data.start.slice(0, 4), editing: false }); this.render(); wx.showToast({ title: '记录已保存', icon: 'success' });
    } catch (error) { this.setData({ status: error.message }); }
  }
});
