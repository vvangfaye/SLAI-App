"""Read-only anonymous school login probe. Never submits credentials or emits cookies."""
import concurrent.futures
import http.cookiejar
import json
import urllib.request
import urllib.parse
import urllib.error
from html.parser import HTMLParser

HOSTS = {'sis.slai.edu.cn', 'stu.slai.edu.cn', 'sts.slai.edu.cn'}

def safe_url(url):
    p = urllib.parse.urlsplit(url)
    return {'host': p.hostname, 'path': p.path.split(';')[0], 'query_keys': sorted(urllib.parse.parse_qs(p.query))}

class Forms(HTMLParser):
    def __init__(self):
        super().__init__()
        self.forms, self.inputs, self.scripts = [], [], []
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'form':
            self.forms.append({'method': a.get('method'), 'action': safe_url(a.get('action', ''))})
        if tag == 'input':
            self.inputs.append({'name': a.get('name'), 'type': a.get('type')})
        if tag == 'script' and a.get('src'):
            self.scripts.append(safe_url(a['src']))

class Redirect(urllib.request.HTTPRedirectHandler):
    def __init__(self): self.steps = []
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.steps.append({'status': code, 'from': safe_url(req.full_url), 'to': safe_url(newurl)})
        p = urllib.parse.urlsplit(newurl)
        if p.scheme != 'https' or p.hostname not in HOSTS:
            raise ValueError('Redirect outside school HTTPS allowlist')
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def probe(url):
    jar = http.cookiejar.CookieJar()
    redirects = Redirect()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), redirects)
    result = {'entry': safe_url(url)}
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,application/json'})
        try: response = opener.open(req, timeout=15)
        except urllib.error.HTTPError as error: response = error
        with response:
            body = response.read(600000).decode('utf-8', errors='replace')
            parser = Forms(); parser.feed(body)
            result.update(status=response.code, final=safe_url(response.url), content_type=response.headers.get('Content-Type'), forms=parser.forms, inputs=parser.inputs, scripts=parser.scripts, body_length=len(body))
            result['markers'] = {s: s.lower() in body.lower() for s in ['captcha', 'AuthMethod', 'FormsAuthentication', 'wa=wsignin', 'OAuth', 'UserName', 'Password', '验证码']}
            try:
                data = json.loads(body)
                result['json_shape'] = list(data)[:15] if isinstance(data, dict) else type(data).__name__
            except ValueError: pass
    except Exception as error:
        result['error'] = type(error).__name__
        result['reason'] = str(getattr(error, 'reason', 'request failed'))[:120]
    result['redirects'] = redirects.steps
    result['cookie_metadata'] = [{'name': c.name, 'domain': c.domain, 'secure': c.secure} for c in jar]
    return result

if __name__ == '__main__':
    urls = [
        'https://sis.slai.edu.cn/yjsxt/htxylogin',
        'https://stu.slai.edu.cn/sso/login',
        'https://stu.slai.edu.cn/a/login',
        'https://sis.slai.edu.cn/yjsxt/xtgl/login_slogin.html',
        'https://stu.slai.edu.cn/a/edu/acm/swipe/listData?page=1&limit=1',
    ]
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        print(json.dumps(list(pool.map(probe, urls)), ensure_ascii=False, indent=2))
