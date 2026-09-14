const store = require('../../services/store');
const d = require('../../utils/domain');
const calendar = require('../../utils/calendar');
const ical = require('../../utils/ical');
Page({
  data: { start: d.dateKey().slice(0, 7) + '-01', end: d.addDays(calendar.shiftMonth(d.dateKey().slice(0, 7), 1) + '-01', -1), status: '', count: 0, busy: false },
  onLoad(options = {}) { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(options.month || '')) this.setData({ start: options.month + '-01', end: d.addDays(calendar.shiftMonth(options.month, 1) + '-01', -1) }); },
  onShow() { this.preview(); },
  onUnload() { this.gone = true; },
  change(e) { const field = e.currentTarget.dataset.field; if (['start', 'end'].includes(field)) { this.setData({ [field]: e.detail.value }); this.preview(); } },
  semester() { const data = store.read(), maxWeek = data.courses.reduce((n, c) => Math.max(n, ...c.weeks), 1); this.setData({ start: data.semesterStart, end: d.addDays(data.semesterStart, maxWeek * 7 - 1) }); this.preview(); },
  preview() {
    try { const data = store.read(); const result = ical.generate(data, this.data.start, this.data.end); this.setData({ count: result.count, status: '', demo: data.source === 'demo' }); }
    catch (e) { this.setData({ count: 0, status: e.message }); }
  },
  async exportFile() {
    if (this.data.busy) return;
    this.setData({ busy: true, status: '' });
    try {
      if (typeof wx.shareFileMessage !== 'function' || !wx.env || !wx.env.USER_DATA_PATH) throw new Error('当前环境不支持文件导出，请在手机微信中使用');
      const data = store.read(); if (data.source !== 'school') throw new Error('请先同步真实课表');
      const result = ical.generate(data, this.data.start, this.data.end);
      if (!result.count) throw new Error('所选范围没有课程');
      const filePath = wx.env.USER_DATA_PATH + '/hetao-courses.ics';
      const fs = wx.getFileSystemManager();
      await new Promise((resolve, reject) => fs.writeFile({ filePath, data: result.text, encoding: 'utf8', success: resolve, fail: () => reject(new Error('文件写入失败，请检查存储空间')) }));
      try {
        if (this.gone) return;
        await new Promise((resolve, reject) => wx.shareFileMessage({ filePath, fileName: '河套日常课表.ics', success: resolve, fail: e => reject(new Error(/cancel/i.test(e.errMsg || '') ? '已取消导出' : '文件分享失败，请重试')) }));
        if (!this.gone) this.setData({ status: '日历文件已导出' });
      } finally { try { fs.unlinkSync(filePath); } catch (_) {} }
    } catch (e) { if (!this.gone) this.setData({ status: e.message }); }
    finally { if (!this.gone) this.setData({ busy: false }); }
  }
});
