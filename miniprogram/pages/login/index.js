const campus = require('../../services/campus');
const d = require('../../utils/domain');
const fillDiagnostics = require('../../utils/fill-diagnostics');
const { LoginProbe, urlParts } = require('../../services/login-probe');
const connectionDiagnostics = require('../../utils/connection-diagnostics');
Page({
  data: { username: '', password: '', remember: true, month: d.dateKey().slice(0, 7), busy: false, checking: false, status: '', connectionReport: '' },
  onLoad(options) { if (options.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(options.month)) this.setData({ month: options.month }); },
  trackFill(e) {
    if (!fillDiagnostics.available()) return;
    this.fillTrace = this.fillTrace || [];
    fillDiagnostics.record(this.fillTrace, e.currentTarget && e.currentTarget.dataset.field, e.type, e.detail && e.detail.value);
  },
  userInput(e) { this.trackFill(e); if (typeof e.detail.value === 'string') this.setData({ username: e.detail.value }); },
  passwordInput(e) {
    this.trackFill(e);
    const password = e.detail.value;
    if (typeof password !== 'string') return;
    this.password = password;
    this.setData({ password });
  },
  rememberChange(e) { this.setData({ remember: !!e.detail.value }); },
  async login(e) {
    if (this.data.busy || this.data.checking) return;
    // Read native form values so autofill need not emit an input event.
    const values = e && e.detail && e.detail.value;
    if (fillDiagnostics.available()) {
      this.fillTrace = this.fillTrace || [];
      for (const field of ['username', 'password']) fillDiagnostics.record(this.fillTrace, field, 'submit', values && values[field]);
    }
    const username = String(values && values.username || this.data.username || '').trim();
    const password = values && values.password || this.password || this.data.password || '';
    if (!username || !password) { this.setData({ status: '请填写完整校园登录名和密码' }); return; }
    this.password = '';
    this.setData({ busy: true, password: '' });
    try {
      const result = await campus.sync({ username, password, remember: this.data.remember, month: this.data.month, progress: status => { if (!this.gone) this.setData({ status }); } });
      if (!this.gone) {
        // Clear busy before navigation: onUnload must not close a successful session.
        this.setData({ busy: false, password: '' });
        if (result && result.rememberWarning) wx.showToast({ title: result.rememberWarning, icon: 'none', duration: 4000 });
        this.home();
      }
    } catch (e) { if (!this.gone) this.setData({ status: e.message }); }
    finally { if (!this.gone) this.setData({ busy: false, password: '' }); }
  },
  async checkConnection() {
    if (this.data.busy || this.data.checking) return;
    const probe = new LoginProbe();
    const network = connectionDiagnostics.networkType();
    let failure;
    this.connectionProbe = probe;
    this.setData({ checking: true, connectionReport: '', status: '正在检查中转服务与学校登录页，不提交账号密码…' });
    try {
      // A fresh anonymous session never reuses the user's login cookies.
      const response = await probe.request('https://sis.slai.edu.cn/yjsxt/htxylogin');
      if (response.statusCode !== 200 || urlParts(response.url).host !== 'sts.slai.edu.cn' || !/id=["']loginForm["']/.test(response.data) || !/FormsAuthentication/.test(response.data)) {
        const error = new Error('已连接中转服务，但学校登录页返回异常，请管理员检查校园通道（RELAY_ENTRY_UNEXPECTED）');
        error.code = 'RELAY_ENTRY_UNEXPECTED'; throw error;
      }
      if (!this.gone) this.setData({ status: '连接正常：中转服务与学校登录页均可访问，可以继续登录。' });
    } catch (error) {
      failure = error;
      if (!this.gone) this.setData({ status: error.message });
    } finally {
      probe.close();
      this.connectionProbe = null;
      const report = connectionDiagnostics.report(failure, await network);
      if (!this.gone) this.setData({ checking: false, connectionReport: report });
    }
  },
  copyConnectionReport() {
    if (!this.data.connectionReport || this.data.checking) return;
    wx.setClipboardData({ data: this.data.connectionReport, fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }) });
  },
  home() { wx.switchTab({ url: '/pages/home/index' }); },
  fillHelp() {
    const canCheck = fillDiagnostics.available();
    wx.showModal({
      title: '密码填充帮助',
      content: '系统填充无效时，可在 iPhone「密码」中复制校园密码，再长按密码框粘贴。' + (canCheck ? '也可打开原生输入框对照检查，仅记录是否收到值，不记录或发送账号密码。' : ''),
      confirmText: canCheck ? '检查填充' : '知道了',
      showCancel: canCheck,
      success: result => {
        if (canCheck && result.confirm) wx.navigateTo({ url: '/pages/fill-check/index?baseline=' + encodeURIComponent(JSON.stringify(this.fillTrace || [])) });
      }
    });
  },
  onUnload() { this.gone = true; this.password = ''; if (this.connectionProbe) this.connectionProbe.close(); if (this.data.busy) campus.logout().catch(() => wx.showToast({ title: '清除登录失败，请在「我的」重试', icon: 'none' })); }
});
