// Compatibility route for earlier preview and trial QR codes.
Page({
  onLoad() { this.home(); },
  home() { wx.switchTab({ url: '/pages/home/index' }); }
});
