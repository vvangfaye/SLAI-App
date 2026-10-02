// A copyable, bounded report with no form values, URLs with queries or cookies.
const { RELAY_ORIGIN } = require('../services/relay-protocol');
const NETWORKS = ['wifi', '2g', '3g', '4g', '5g', 'unknown', 'none'];
function networkType() {
  return new Promise(resolve => {
    if (typeof wx.getNetworkType !== 'function') { resolve('unknown'); return; }
    let done = false;
    const finish = value => {
      if (done) return;
      done = true; clearTimeout(timer);
      resolve(NETWORKS.includes(value) ? value : 'unknown');
    };
    const timer = setTimeout(() => finish('unknown'), 1500);
    try { wx.getNetworkType({ success: result => finish(result && result.networkType), fail: () => finish('unknown') }); }
    catch (_) { finish('unknown'); }
  });
}
function report(error, network) {
  let app = {}, device = {};
  try { if (typeof wx.getAppBaseInfo === 'function') app = wx.getAppBaseInfo() || {}; } catch (_) { /* optional */ }
  try { if (typeof wx.getDeviceInfo === 'function') device = wx.getDeviceInfo() || {}; } catch (_) { /* optional */ }
  const version = value => typeof value === 'string' && /^\d{1,4}(?:\.\d{1,4}){0,4}$/.test(value) ? value : 'unknown';
  const system = typeof device.system === 'string' && device.system.length <= 80 && /^(?:iOS|Android|Windows|macOS|Mac OS X|HarmonyOS) [\d.]+$/i.test(device.system) ? device.system : 'unknown';
  const code = !error ? 'OK' : /^RELAY_[A-Z_]+$/.test(error.code || '') ? error.code : 'CHECK_FAILED';
  return [
    '连接检查 ND-2', `中转域名: ${RELAY_ORIGIN.replace(/^https:\/\//, '')}`, `结果: ${code}`,
    `微信 errno: ${error && Number.isSafeInteger(error.errno) ? error.errno : 'none'}`,
    `原生错误: ${error && /^ERR_[A-Z_]{1,50}$/.test(error.nativeCode || '') ? error.nativeCode : 'none'}`,
    `原生错误号: ${error && Number.isSafeInteger(error.nativeNumber) ? error.nativeNumber : 'none'}`,
    `系统: ${system}`, `微信版本: ${version(app.version)}`, `基础库: ${version(app.SDKVersion)}`,
    `网络: ${NETWORKS.includes(network) ? network : 'unknown'}`
  ].join('\n');
}
module.exports = { networkType, report };
