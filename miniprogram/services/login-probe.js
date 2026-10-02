// In-memory school authentication. No analytics, logging or credential storage.
const { PROTOCOL, RELAY_URL, decodeResponse, connectionError } = require('./relay-protocol');
const ROUTE_HOSTS = { sis: 'sis.slai.edu.cn', sts: 'sts.slai.edu.cn', stu: 'stu.slai.edu.cn' };
const ROUTES = {};
Object.keys(ROUTE_HOSTS).forEach(route => { ROUTES[ROUTE_HOSTS[route]] = route; });
const HOSTS = Object.keys(ROUTES);
const PROXY_ORIGIN = 'https://openslai.cn';
function validatePath(path) {
  const invalid = () => new Error('认证跳转路径包含不安全的点段或分隔符，已停止请求');
  if (/[\u0000-\u0020\u007f]/.test(path)) throw invalid();
  // Nginx decodes paths before selecting a route. Reject ambiguous paths before
  // adding the proxy prefix, including nested encoding across proxy hops.
  let decoded = path;
  for (;;) {
    if (/[\\\u0000-\u001f\u007f]|%(?:2f|5c)/i.test(decoded) || decoded.split('/').some(part => /^\.\.?$/.test(part.trim()))) throw invalid();
    const next = decoded.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    if (next === decoded) return;
    decoded = next;
  }
}
function urlParts(input) {
  const m = /^https:\/\/([a-z0-9.-]+)(?::443)?(\/[^?#]*)?(\?[^#]*)?$/i.exec(input);
  if (!m) throw new Error('认证跳转超出学校 HTTPS 域名范围');
  let host = m[1].toLowerCase();
  let path = m[2] || '/';
  validatePath(path);
  if (host === 'openslai.cn') {
    const routed = /^\/_slai\/(sis|sts|stu)(\/.*)?$/.exec(path);
    if (!routed) throw new Error('认证跳转包含未知代理路由');
    host = ROUTE_HOSTS[routed[1]];
    path = routed[2] || '/';
  }
  if (!HOSTS.includes(host)) throw new Error('认证跳转超出学校 HTTPS 域名范围');
  // Keep the query byte-for-byte: SSO state and callback URLs are opaque data.
  return { host, path, url: `https://${host}${path}${m[3] || ''}` };
}
// Only the server's local FRP gateway needs the legacy /_slai/{school} path.
function gatewayPath(url) {
  const logical = urlParts(url);
  return `/_slai/${ROUTES[logical.host]}${logical.url.slice(`https://${logical.host}`.length)}`;
}
function resolve(base, target) {
  let url;
  if (/^https:\/\//i.test(target)) url = target;
  else if (/^\/_slai(?:\/|\?|$)/.test(target)) url = PROXY_ORIGIN + target;
  else if (target.startsWith('/') && !target.startsWith('//')) url = `https://${urlParts(base).host}${target}`;
  else if (target.startsWith('?')) url = urlParts(base).url.split('?')[0] + target;
  else throw new Error('遇到未支持的跳转形式，需要进一步适配');
  return urlParts(url).url;
}
function header(headers, name) {
  const key = Object.keys(headers || {}).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}
class CookieJar {
  constructor() { this.rows = []; }
  clear() { this.rows = []; }
  receive(url, lines, now = Date.now()) {
    const source = urlParts(url);
    (lines || []).forEach(line => {
      const parts = line.split(';').map(v => v.trim());
      const pair = parts.shift(); const at = pair.indexOf('=');
      if (at < 1) return;
      const cookie = { name: pair.slice(0, at), value: pair.slice(at + 1), domain: source.host, hostOnly: true, path: source.path.slice(0, source.path.lastIndexOf('/')) || '/', expires: Infinity };
      let maxAge;
      for (const part of parts) {
        const index = part.indexOf('='); const key = (index < 0 ? part : part.slice(0, index)).toLowerCase(); const value = index < 0 ? '' : part.slice(index + 1);
        if (key === 'domain') { cookie.domain = value.replace(/^\./, '').toLowerCase(); cookie.hostOnly = false; }
        if (key === 'path' && value.startsWith('/')) cookie.path = value;
        if (key === 'expires' && Number.isFinite(Date.parse(value))) cookie.expires = Date.parse(value);
        if (key === 'max-age' && /^-?\d+$/.test(value)) maxAge = Number(value);
      }
      if (!(cookie.domain === 'slai.edu.cn' || HOSTS.includes(cookie.domain))) return;
      if (!(source.host === cookie.domain || source.host.endsWith('.' + cookie.domain))) return;
      if (maxAge !== undefined) cookie.expires = maxAge <= 0 ? 0 : now + maxAge * 1000;
      this.rows = this.rows.filter(c => !(c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path));
      if (cookie.expires > now) this.rows.push(cookie);
    });
  }
  forUrl(url, now = Date.now()) {
    const dest = urlParts(url);
    return this.rows.filter(c => c.expires > now && (c.hostOnly ? dest.host === c.domain : dest.host === c.domain || dest.host.endsWith('.' + c.domain)) && (dest.path === c.path || dest.path.startsWith(c.path.endsWith('/') ? c.path : c.path + '/'))).sort((a, b) => b.path.length - a.path.length).map(c => `${c.name}=${c.value}`).join('; ');
  }
}
function wxTransport(options) {
  const logical = urlParts(options.url).url;
  return new Promise((resolveRequest, reject) => {
    wx.request({ url: RELAY_URL, method: 'POST',
      header: { 'Content-Type': 'application/json', Accept: 'application/json' },
      data: JSON.stringify({ protocol: PROTOCOL, url: logical, method: options.method, header: options.header, data: options.data }),
      dataType: 'text', responseType: 'text', redirect: 'manual', timeout: 25000,
      success: res => {
        try { resolveRequest(decodeResponse(res)); } catch (error) { reject(error); }
      },
      fail: error => reject(connectionError(error))
    });
  });
}
class LoginProbe {
  constructor(transport = wxTransport) { this.transport = transport; this.jar = new CookieJar(); this.cancelled = false; }
  close() { this.cancelled = true; this.jar.clear(); }
  async request(url, method = 'GET', data = '') {
    for (let hop = 0; hop < 12; hop++) {
      if (this.cancelled) throw new Error('验证已结束');
      url = urlParts(url).url;
      const res = await this.transport({ url, method, data, header: { Cookie: this.jar.forUrl(url), 'Content-Type': 'application/x-www-form-urlencoded', ...(/\/a\/|xskbcx_|index_cx/.test(url) ? { Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest' } : {}) } });
      if (this.cancelled) throw new Error('验证已结束');
      const raw = header(res.header, 'set-cookie');
      const cookies = res.cookies && res.cookies.length ? res.cookies : Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/,(?=\s*[^;,=\s]+=)/) : [];
      this.jar.receive(url, cookies);
      const location = header(res.header, 'location');
      if (res.statusCode >= 300 && res.statusCode < 400 && location) {
        const next = resolve(url, location);
        // Never forward a credential-bearing POST to another host.
        if ((res.statusCode === 307 || res.statusCode === 308) && method === 'POST' && urlParts(next).host !== urlParts(url).host) throw new Error('跨域 POST 重定向需要人工核实，已停止');
        if (res.statusCode === 303 || ((res.statusCode === 301 || res.statusCode === 302) && method === 'POST')) { method = 'GET'; data = ''; }
        url = next; continue;
      }
      return { ...res, url };
    }
    throw new Error('重定向次数过多，可能需要交互式认证');
  }
  async authenticate(entry, username, password) {
    const page = await this.request(entry);
    const html = String(page.data);
    if (urlParts(page.url).host !== 'sts.slai.edu.cn') {
      if (/FormsAuthentication/.test(html) && /id=["']loginForm["']/.test(html)) {
        throw new Error('已收到学校登录表单，但当前客户端未按预期返回中间重定向，无法确认 Cookie 归属。密码尚未提交。请在手机微信扫码预览，先运行“无需密码”检查。');
      }
      throw new Error('登录入口响应未到达预期认证地址，密码尚未提交；请先运行“无需密码”检查。');
    }
    const form = html.match(/<form\b[^>]*\bid=["']loginForm["'][^>]*>/i);
    const action = form && form[0].match(/\baction=["']([^"']+)["']/i);
    if (!action || !/FormsAuthentication/.test(html)) throw new Error('学校登录表单已变化，停止验证');
    const target = resolve(page.url, action[1].replace(/&amp;/g, '&'));
    if (urlParts(target).host !== 'sts.slai.edu.cn') throw new Error('认证表单目标不是学校身份服务器');
    const body = `UserName=${encodeURIComponent(username)}&Password=${encodeURIComponent(password)}&AuthMethod=FormsAuthentication`;
    const result = await this.request(target, 'POST', body);
    if (result.statusCode >= 500 && result.statusCode < 600) {
      const error = new Error(`认证服务暂时不可用（HTTP ${result.statusCode}），请稍后重试`);
      error.code = 'AUTH_SERVER_ERROR';
      throw error;
    }
    if (urlParts(result.url).host === 'sts.slai.edu.cn') {
      const error = new Error('认证未完成：可能是账号格式、密码或二次验证；请先在学校网页确认，不自动重试');
      error.code = 'AUTH_REQUIRED';
      throw error;
    }
    if (result.statusCode < 200 || result.statusCode >= 300) throw new Error('认证返回异常，尚未证明会话有效');
  }
}
module.exports = { CookieJar, LoginProbe, resolve, gatewayPath, wxTransport, urlParts };
