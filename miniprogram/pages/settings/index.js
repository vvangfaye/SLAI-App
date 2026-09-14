const campus = require('../../services/campus');
const store = require('../../services/store');
const daily = require('../../utils/daily');
Page({
  onShow() { this.hidden = false; this.render(); return campus.ready().then(() => { if (!this.hidden) this.render(); }); },
  onHide() { this.hidden = true; },
  onUnload() { this.hidden = true; },
  render() { const data = store.read(); this.setData({ ...store.prefs(), label: store.sourceLabel(data), savedAt: daily.updated(data.savedAt) || '尚未同步', source: data.source, connected: campus.connected(), remembered: campus.remembered() }); },
  openLeave() { wx.navigateTo({ url: '/pages/leave/index' }); },
  openAgenda() { wx.navigateTo({ url: '/pages/agenda/index' }); },
  exportCalendar() { wx.navigateTo({ url: '/pages/calendar-export/index' }); },
  targetChange(e) { const target = Number(e.detail.value); try { store.setPrefs({ ...store.prefs(), target }); this.setData({ target }); } catch (_) { wx.showToast({ title: '保存失败，请重试', icon: 'none' }); } },
  showChange(e) { try { store.setPrefs({ ...store.prefs(), showCourses: e.detail.value }); this.setData({ showCourses: e.detail.value }); } catch (_) { wx.showToast({ title: '保存失败，请重试', icon: 'none' }); } },
  integration() { wx.navigateTo({ url: '/pages/login/index' }); },
  async sync() {
    if (this.data.busy) return;
    await campus.ready();
    if (this.data.busy || this.hidden) return;
    if (!campus.connected() && !campus.remembered()) { this.integration(); return; }
    this.setData({ busy: true, status: '正在同步…' });
    try { await campus.sync({ progress: status => this.setData({ status }) }); }
    catch (e) { this.setData({ status: e.message }); }
    finally { this.setData({ busy: false }); this.onShow(); }
  },
  async logout() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try { await campus.logout(); wx.showToast({ title: '已退出并清除登录凭据', icon: 'none' }); }
    catch (e) { this.setData({ status: e.message }); }
    finally { this.setData({ busy: false }); this.render(); }
  },
  clearData() {
    if (this.data.busy) return;
    wx.showModal({ title: '清除本地校园数据？', content: '同时清除已保存的登录。个人设置、年假及日程记录保留。', success: async result => {
      if (!result.confirm || this.data.busy) return;
      this.setData({ busy: true });
      try { await campus.logout(); store.clear(); wx.showToast({ title: '已清除数据与登录', icon: 'none' }); }
      catch (_) { wx.showToast({ title: '清除失败，请重试', icon: 'none' }); }
      finally { this.setData({ busy: false }); this.render(); }
    } });
  }
});
