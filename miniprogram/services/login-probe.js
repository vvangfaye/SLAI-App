// Experimental, in-memory authentication probe. No analytics, logging or storage.
const HOSTS = ['sis.slai.edu.cn', 'stu.slai.edu.cn', 'sts.slai.edu.cn'];
function urlParts(url) {
  const m = /^https:\/\/([a-z0-9.-]+)(\/[^#]*)?$/i.exec(url);
  if (!m || !HOSTS.includes(m[1].toLowerCase())) throw new Error('认证跳转超出学校 HTTPS 域名范围');
  return { host: m[1].toLowerCase(), path: (m[2] || '/').split('?')[0], url };
}
function resolve(base, target) {
  let url;
  if (/^https:\/\//i.test(target)) url = target;
  else if (target.startsWith('/') && !target.startsWith('//')) url = `https://${urlParts(base).host}${target}`;
  else if (target.startsWith('?')) url = base.split('?')[0] + target;
  else throw new Error('遇到未支持的跳转形式，需要进一步适配');
  urlParts(url);
  return url;
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
  return new Promise((resolveRequest, reject) => {
    let received;
    const task = wx.request({ ...options, dataType: 'text', responseType: 'text', redirect: 'manual', timeout: 20000,
      success: res => resolveRequest({ ...received, ...res, header: { ...(received && received.header), ...res.header } }),
      fail: () => {
        // With redirect: manual some clients end the request after headers.
        if (received && received.statusCode >= 300 && received.statusCode < 400 && header(received.header, 'location')) resolveRequest({ statusCode: received.statusCode, header: received.header, cookies: received.cookies || [], data: '' });
        else if (received && header(received.header, 'location')) reject(new Error('当前客户端未提供重定向状态码，请使用微信真机验证'));
        else reject(new Error('请求未完成：请检查网络、合法域名与 HTTPS 配置'));
      }
    });
    task.onHeadersReceived(r => { received = r; });
  });
}
class LoginProbe {
  constructor(transport = wxTransport) { this.transport = transport; this.jar = new CookieJar(); this.cancelled = false; }
  close() { this.cancelled = true; this.jar.clear(); }
  async request(url, method = 'GET', data = '') {
    for (let hop = 0; hop < 12; hop++) {
      if (this.cancelled) throw new Error('验证已结束');
      urlParts(url);
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
    if (urlParts(result.url).host === 'sts.slai.edu.cn') {
      const error = new Error('认证未完成：可能是账号格式、密码或二次验证；请先在学校网页确认，不自动重试');
      error.code = 'AUTH_REQUIRED';
      throw error;
    }
    if (result.statusCode < 200 || result.statusCode >= 300) throw new Error('认证返回异常，尚未证明会话有效');
  }
  async verify(username, password, progress) {
    progress('正在验证教务系统登录…');
    await this.authenticate('https://sis.slai.edu.cn/yjsxt/htxylogin', username, password);
    const semesterResponse = await this.request('https://sis.slai.edu.cn/yjsxt/xtgl/index_cxCurrentSemester.html?gnmkdm=index', 'POST');
    let semester;
    try { semester = JSON.parse(semesterResponse.data); } catch (_) { throw new Error('教务登录后未取得学期 JSON，会话验证未通过'); }
    const year = String(semester.year || '').match(/^\d{4}/);
    const term = { '1': '3', '2': '12', '3': '16' }[String(semester.semester)];
    if (!year || !term) throw new Error('学期数据结构不符合已知格式');
    const schedule = await this.request('https://sis.slai.edu.cn/yjsxt/kbcx/xskbcx_cxXsKb.html?gnmkdm=index', 'POST', `localeKey=zh_CN&xnm=${year[0]}&xqm=${term}&zs=`);
    let courses;
    try { courses = JSON.parse(schedule.data).kbList; } catch (_) { /* report below */ }
    if (schedule.statusCode !== 200 || !Array.isArray(courses)) throw new Error('课表接口未返回有效 kbList，会话验证未通过');
    progress(`教务已通过：返回 ${courses.length} 条课程记录（不保存内容）。正在验证考勤…`);
    // Reuse the in-memory AD FS session; only submit credentials if redirected to a login form.
    const student = await this.request('https://stu.slai.edu.cn/sso/login');
    if (urlParts(student.url).host === 'sts.slai.edu.cn') {
      // Stop instead of automatically submitting the password a second time.
      throw new Error('教务已通过；考勤需要独立认证，当前验证停止，不自动再次提交密码');
    }
    const attendance = await this.request('https://stu.slai.edu.cn/a/edu/acm/swipe/listData?page=1&limit=1');
    let payload;
    try { payload = JSON.parse(attendance.data); } catch (_) { /* report below */ }
    if (attendance.statusCode !== 200 || !payload || ![0, '0'].includes(payload.code) || !Array.isArray(payload.data)) throw new Error('教务已通过；考勤接口尚未返回有效业务数据');
    progress('验证通过：小程序直接认证后，课表和考勤均返回有效业务数据。未保存账号、密码、Cookie 或业务记录。');
  }
}
module.exports = { CookieJar, LoginProbe, resolve, wxTransport };
