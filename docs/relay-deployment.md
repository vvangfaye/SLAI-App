# 登录中转接口部署

2026-10-02 微信模拟器实测会在客户端收到响应前自动跟随学校的 302，直接访问 STS 后报 `ERR_CERT_AUTHORITY_INVALID`。本地 Node 登录曾成功，是因为它能逐次处理跳转。新接口将学校响应封装为 HTTP 200 JSON，小程序自行处理其中的状态码、Location 和 Set-Cookie；不依赖模拟器是否遵守 `redirect: manual`。

## 部署位置

在**能解析并访问 SIS、STS、STU 的校园网/VPN 主机**运行 [server/relay.js](../server/relay.js)，需要 Node.js 22 或更新版本，无第三方依赖。默认只监听本机 `127.0.0.1:8787`，复用现有「公网 Nginx → FRP → 局域网网关」链路。

新接口必须抵达这个 Node 服务，不能继续转发到原来的学校反向代理；原来的三个路径可保留给旧版。

1. 将更新后的仓库复制或拉取到校园侧主机，在项目目录运行：

   ```sh
   node server/relay.js
   ```

   用已有的服务管理器保持进程运行；可通过 `SLAI_RELAY_PORT` 设置其他本地端口。不要将该 HTTP 端口直接暴露公网。

2. 在校园侧 Nginx 对应的 `server` 块内加入 [server/nginx-relay.conf](../server/nginx-relay.conf)。示例与 Node 服务位于同一主机；不同主机应使用受保护的私有通道。

3. 公网 `openslai.cn` 的 HTTPS `server` 块也增加相同的 `location = /_slai/relay`，将其中 `proxy_pass` 改成**你现有 FRP 通往校园侧 Nginx 的地址**。保留路径 `/_slai/relay`，不要加尾部斜杠，不要重写到 SIS/STS/STU。两层都要保留示例中的禁用日志、缓冲、缓存、自动重试设置。校验配置后再重载：

   ```sh
   nginx -t
   nginx -s reload
   ```

4. 本机健康检查 `http://127.0.0.1:8787/healthz` 应返回 `{"protocol":"slai-relay-v1","ready":true}`。它只证明服务启动，不证明学校网络可达。

5. 从公网检查首个跳转，**无需账号密码**：

   ```sh
   curl --max-time 25 -sS \
     https://openslai.cn/_slai/relay \
     -H 'Content-Type: application/json' \
     --data '{"protocol":"slai-relay-v1","url":"https://sis.slai.edu.cn/yjsxt/htxylogin","method":"GET","header":{},"data":""}' \
     | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{const r=JSON.parse(s);console.log({protocol:r.protocol,statusCode:r.statusCode,hasLocation:!!(r.header&&r.header.location),error:r.error&&r.error.code})})'
   ```

   外层必须为 HTTP 200，不能带 HTTP `Location` 或 `Set-Cookie`；JSON 中应有协议标记和学校的 302/跳转地址。上面的命令只打印状态与跳转是否存在，不打印 SSO 参数或 Cookie。

6. 重新编译小程序，先测试登录入口，再用本人账号验证课表和考勤。真机保持合法域名和 HTTPS 校验开启，request 合法域名仍只需 `https://openslai.cn`。更新客户端必须与新接口部署配套；旧网关返回 404/HTML 时会显示“代理登录接口尚未部署或版本不匹配”。

## 协议与会话

客户端只向 `https://openslai.cn/_slai/relay` 发送 POST JSON，学校目标 URL、原始 GET/POST、Cookie 和表单正文放在 JSON 中。服务端只允许三个学校 HTTPS 域名和标准 443 端口，复用路径校验，拒绝点段与编码分隔符。学校查询串保持原样。

服务端每次只请求一个上游，不跟随重定向，保留独立 Set-Cookie 行；响应只携带 Location、Set-Cookie、Content-Type。小程序按学校逻辑域维护内存 Cookie，302/303 后移除 POST 正文，阻止跨域保留 POST 的 307/308。服务端无 Cookie 仓库、账号存储或逐请求日志，不共享不同用户会话。

请求最多 256 KiB，解压后响应最多 4 MiB，上游总超时 20 秒，连接关闭时取消上游请求。TLS 证书校验始终开启；若中转主机不信任学校证书，会返回 `UPSTREAM_TLS_ERROR`。应修复证书链，或在核实后通过 Node 的 `NODE_EXTRA_CA_CERTS` 配置信任的学校 CA，不能关闭校验。不得导出含密码、Cookie 或完整 SSO 地址的调试日志。

单改 Nginx `proxy_redirect` 只会改写响应头中的跳转地址，不能保证小程序收到每一跳及按原学校域隔离 Cookie。相关行为见 [Nginx 官方说明](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_redirect)；服务端上游使用 [Node HTTPS 请求](https://nodejs.org/api/https.html#httpsrequesturl-options-callback)。

## 验证边界

本地回归测试覆盖实际 HTTP 中转响应、小程序默认传输、登录多次跳转、Cookie 隔离、跨域 POST 拦截、路径拒绝和错误分类。学校上游在这些测试中使用虚构响应；只有部署后在微信模拟器和手机读到真实业务数据，才能确认本次修复可用。
