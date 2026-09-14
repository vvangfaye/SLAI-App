const KEY = 'hetao.login.encrypted.v1';
const DISABLED = 'hetao.login.disabled.v1';
let revision = 0;
let pending = Promise.resolve();

function supported() {
  return typeof wx !== 'undefined' && typeof wx.canIUse === 'function' &&
    wx.canIUse('setStorage.object.encrypt') && wx.canIUse('getStorage.object.encrypt');
}
function sequence(operation) {
  const task = pending.then(operation);
  pending = task.catch(() => {});
  return task;
}
function valid(data) {
  return data && data.version === 1 && typeof data.username === 'string' && data.username.trim().length > 0 && data.username.length <= 120 &&
    typeof data.password === 'string' && data.password.length > 0 && data.password.length <= 128;
}
async function read() {
  const version = revision;
  await pending;
  if (version !== revision || !supported() || wx.getStorageSync(DISABLED)) return null;
  const data = await new Promise((resolve, reject) => {
    wx.getStorage({ key: KEY, encrypt: true, success: res => resolve(res.data), fail: err => {
      if (/not found|data not found/i.test(err.errMsg || '')) resolve(null);
      else reject(new Error('已保存的登录无法读取，请重新登录。'));
    } });
  });
  if (version !== revision || !valid(data)) return null;
  return { username: data.username, password: data.password };
}
function save(credentials) {
  const version = revision;
  const data = { version: 1, username: credentials.username, password: credentials.password };
  if (!valid(data)) return Promise.reject(new Error('登录信息格式有误，未保存。'));
  if (!supported()) return Promise.reject(new Error('当前微信不支持加密记住登录，请更新微信。'));
  return sequence(async () => {
    if (version !== revision) return false;
    await new Promise((resolve, reject) => wx.setStorage({ key: KEY, data, encrypt: true, success: resolve, fail: () => reject(new Error('未能加密保存登录，请检查存储空间。')) }));
    if (version !== revision) { wx.removeStorageSync(KEY); return false; }
    wx.removeStorageSync(DISABLED);
    return true;
  });
}
function clear() {
  revision++;
  if (typeof wx === 'undefined') return Promise.resolve();
  // Disable restoration immediately, even if a write is still in flight or removal fails.
  try { wx.setStorageSync(DISABLED, true); }
  catch (_) { return Promise.reject(new Error('无法清除已保存的登录，请重试。')); }
  return sequence(() => {
    try { wx.removeStorageSync(KEY); }
    catch (_) { throw new Error('无法清除已保存的登录，请重试。'); }
  });
}
module.exports = { read, save, clear, supported };
