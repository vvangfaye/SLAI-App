const diagnostics = require('../../utils/fill-diagnostics');
Page({
  data: { enabled: false, checked: false, result: '', report: '' },
  onLoad(options = {}) {
    if (!diagnostics.available()) { wx.switchTab({ url: '/pages/home/index' }); return; }
    this.baseline = diagnostics.readTrace(options.baseline);
    this.trace = [];
    this.setData({ enabled: true });
  },
  track(e) {
    // Do not setData, change focus or write an input's value during the check.
    if (!this.data.enabled || this.data.checked) return;
    diagnostics.record(this.trace, e.currentTarget.dataset.field, e.type, e.detail && e.detail.value);
  },
  check(e) {
    if (!this.data.enabled || this.data.checked) return;
    const values = e.detail.value || {};
    for (const field of ['username', 'password']) diagnostics.record(this.trace, field, 'submit', values[field]);
    const received = typeof values.password === 'string' && values.password.length > 0;
    let environment = '';
    try {
      const info = wx.getSystemInfoSync();
      environment = `系统 ${info.system} / 微信 ${info.version} / 基础库 ${info.SDKVersion}`;
    } catch (_) {}
    const report = ['填充检查 AF-1', environment, '登录页事件', diagnostics.describe(this.baseline), '原生表单事件', diagnostics.describe(this.trace)].filter(Boolean).join('\n');
    // Removing the form destroys its native fields after capturing presence flags.
    this.setData({ checked: true, result: received ? '原生表单收到密码' : '原生表单未收到密码', report });
  },
  copyReport() { if (this.data.checked) wx.setClipboardData({ data: this.data.report }); },
  retry() { this.trace = []; this.setData({ checked: false, result: '', report: '' }); },
  back() { wx.navigateBack(); },
  onUnload() { this.trace = []; this.baseline = []; }
});
