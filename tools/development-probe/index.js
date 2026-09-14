const { LoginProbe } = require('../../services/login-probe');
Page({
  data: { username: '', password: '', busy: false, status: '尚未执行真机验证', messages: [] },
  userInput(e) { this.setData({ username: e.detail.value }); },
  passwordInput(e) { this.setData({ password: e.detail.value }); },
  async preflight() {
    if (this.data.busy) return;
    this.setData({ busy: true, status: '检查登录入口（不提交账号密码）', messages: [] });
    this.probe = new LoginProbe();
    try {
      const res = await this.probe.request('https://sis.slai.edu.cn/yjsxt/htxylogin');
      const ready = res.statusCode === 200 && /^https:\/\/sts\.slai\.edu\.cn\//.test(res.url) && /FormsAuthentication/.test(String(res.data));
      if (!this.gone) this.setData({ status: ready ? '登录入口检查通过' : '登录入口尚未确认', messages: [ready ? '小程序已通过请求和跳转到达学校认证表单；尚未提交密码或验证业务数据。' : `返回 HTTP ${res.statusCode}，请求目标 ${res.url.split('?')[0]}；认证标记 ${/FormsAuthentication/.test(String(res.data)) ? '存在' : '未找到'}，登录表单 ${/id=["']loginForm["']/.test(String(res.data)) ? '存在' : '未找到'}。`] });
    } catch (error) { if (!this.gone) this.setData({ status: '登录入口检查失败', messages: [error.message] }); }
    finally { this.probe.close(); if (!this.gone) this.setData({ busy: false }); }
  },
  async run() {
    if (this.data.busy) return;
    const username = this.data.username.trim(); const password = this.data.password;
    if (!username || !password) { this.setData({ status: '请填写校园账号和密码；账号格式与学校登录页一致' }); return; }
    this.setData({ busy: true, password: '', messages: [], status: '验证中' });
    this.probe = new LoginProbe();
    const progress = message => { if (!this.gone) this.setData({ messages: [...this.data.messages, message] }); };
    try { await this.probe.verify(username, password, progress); if (!this.gone) this.setData({ status: '本次验证通过' }); }
    catch (error) { if (!this.gone) this.setData({ status: '本次未完成验证' }); progress(error.message); }
    finally { this.probe.close(); if (!this.gone) this.setData({ busy: false, password: '', username: '' }); }
  },
  onUnload() { this.gone = true; if (this.probe) this.probe.close(); }
});
