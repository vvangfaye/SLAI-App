# 登录中转接口部署

2026-10-02 微信模拟器实测会在客户端收到响应前自动跟随学校的 302，直接访问 STS 后报 `ERR_CERT_AUTHORITY_INVALID`。本地 Node 登录曾成功，是因为它能逐次处理跳转。新接口将学校响应封装为 HTTP 200 JSON，小程序自行处理其中的状态码、Location 和 Set-Cookie；不依赖模拟器是否遵守 `redirect: manual`。

## 当前部署（2026-10-02）

客户端外层入口已迁移至 `https://slai-api.wangfaye.cn/_slai/relay`。腾讯云 DNSPod 的 A 记录、有效证书及阿里云 Nginx 配置均已部署；16:27 本机严格校验证书的 TLS 1.2、TLS 1.3/X25519、默认 TLS 1.3 及普通 DNS 匿名请求均取得学校登录页。新域名相关 45 项回归通过（改名前完整 92 项通过），后续 ND-3 诊断的 14 项页面测试通过。微信后台已加入新 request 合法域名，开发工具开启域名与 HTTPS 校验的匿名连接检查通过。16:44 用户确认手机连接检查正常、登录成功；此次真机课表与考勤同步尚未单独确认。旧 `openslai.cn` 公网握手在部分客户端重置，详见[验证记录](login-verification.md)。

已在 `aliyun1` 部署发布版本 `edaab9f`，服务为 `slai-relay.service`，以 `faye` 运行并开机启动。使用经官方 SHA256 校验的 Node.js 22.23.3，监听 `127.0.0.1:8787`，通过现有 `http://127.0.0.1:18080` FRP visitor 请求校园侧网关。新 Nginx location 关闭访问日志、缓冲、缓存和请求自动重试。

- 当前发布链接：`/home/faye/slai-relay/current`；保留旧版本用于恢复。
- 新 Nginx 入口：`/etc/nginx/conf.d/slai-api.conf`；旧 `openslai.conf` 保留；两者复用 `/etc/nginx/snippets/slai-relay.conf`。
- 新域名部署备份：`/etc/nginx/slai-api-backup-20261002T082515Z`；原中转配置备份：`/etc/nginx/slai-relay-backup-20261002T145235`。
- 新域名证书：腾讯云免费证书，2026-12-31 14:59:59（北京时间）到期，需在到期前续期并重新安装；当前没有自动续期。证书和私钥只部署在服务器 `/etc/nginx/ssl/`，不进入仓库。
- 检查服务：`systemctl status slai-relay.service`；重启：`sudo systemctl restart slai-relay.service`。

旧入口曾在本机通过公网无密码检查与微信模拟器真实登录、课表、当月考勤及今日打卡读取；手机移动网络随后复现连接重置。部署时 87 项测试在本机和服务器通过，当前客户端 92 项回归通过。修改 Nginx 后先校验配置，重载后等待新工作进程接管再检查公网响应。

## slai-api.wangfaye.cn 入口配置

1. 在腾讯云 DNSPod 的 `wangfaye.cn` 下新增 `slai-api` 的 A 记录，默认线路指向 `47.97.220.68`，TTL 600 秒。域名仍由腾讯云解析，中转服务仍运行在阿里云。
2. 安装覆盖 `slai-api.wangfaye.cn` 的有效 HTTPS 证书及完整中间证书链。现有 `wangfaye.cn` / `www.wangfaye.cn` 证书不覆盖此子域，不能直接复用。
3. 安装 [server/nginx-api.conf](../server/nginx-api.conf) 中的独立虚拟主机配置，证书路径应与实际安装一致。复用 `/etc/nginx/snippets/slai-relay.conf`，转发到现有 `127.0.0.1:8787`；先备份、执行 `nginx -t`，校验成功后才重载。80 端口返回 404，不承载登录。
4. 微信小程序后台的 request 合法域名增加 `https://slai-api.wangfaye.cn`，不带路径。保留 HTTPS 与合法域名校验，重新编译、生成预览后先用手机移动网络执行“检查连接（无需密码）”。报告里的中转域名应为 `slai-api.wangfaye.cn`，通过后再测试真实登录与同步。

这里只更换客户端外层 HTTPS 入口。`login-probe.js` 中 `openslai.cn` 的路径映射、校园网关接收的 Host 及旧跳转兼容仍属于内部通道配置，不能全局替换。学校上游白名单与 Cookie 归属仍只包含原学校域名，不添加 `slai-api.wangfaye.cn`。

## 部署位置

在**能解析并访问 SIS、STS、STU 的校园网/VPN 主机**运行 [server/relay.js](../server/relay.js)，需要 Node.js 22 或更新版本，无第三方依赖。默认只监听本机 `127.0.0.1:8787`，复用现有「公网 Nginx → FRP → 局域网网关」链路。

新接口必须抵达这个 Node 服务，不能继续转发到原来的学校反向代理；原来的三个路径可保留给旧版。

也可将 Node 服务部署在公网服务器，复用**现有已授权的本机 FRP visitor**：设置 `SLAI_RELAY_GATEWAY=http://127.0.0.1:18080`（端口以实际配置为准）。该设置只接受本机 HTTP 端口，学校目标仍受固定域名与路径校验约束。Node 逐次请求原 `/_slai/{sis|sts|stu}/...` 通道，保持原校园侧网关的 HTTPS/TLS 配置；公网 Nginx 的新接口直接转给本机 Node，无需改 FRP 和校园侧路由。

1. 将更新后的仓库复制或拉取到校园侧主机，在项目目录运行：

   ```sh
   node server/relay.js
   ```

   用已有的服务管理器保持进程运行；可通过 `SLAI_RELAY_PORT` 设置其他本地端口。不要将该 HTTP 端口直接暴露公网。

2. 在校园侧 Nginx 对应的 `server` 块内加入 [server/nginx-relay.conf](../server/nginx-relay.conf)。示例与 Node 服务位于同一主机；不同主机应使用受保护的私有通道。

3. 公网 `slai-api.wangfaye.cn` 的 HTTPS `server` 块增加相同的 `location = /_slai/relay`。当前 `aliyun1` 上 Node 与公网 Nginx 位于同一主机，`proxy_pass` 保持 `http://127.0.0.1:8787`；只有 Node 位于校园侧的拓扑才将其改为现有 FRP 通往 Node 入口的地址。保留路径 `/_slai/relay`，不要加尾部斜杠，不要重写到 SIS/STS/STU。保留示例中的禁用日志、缓冲、缓存、自动重试设置。校验配置后再重载：

   ```sh
   nginx -t
   nginx -s reload
   ```

4. 本机健康检查 `http://127.0.0.1:8787/healthz` 应返回 `{"protocol":"slai-relay-v1","ready":true}`。它只证明服务启动，不证明学校网络可达。

5. 从公网检查首个跳转，**无需账号密码**：

   ```sh
   curl --max-time 25 -sS \
     https://slai-api.wangfaye.cn/_slai/relay \
     -H 'Content-Type: application/json' \
     --data '{"protocol":"slai-relay-v1","url":"https://sis.slai.edu.cn/yjsxt/htxylogin","method":"GET","header":{},"data":""}' \
     | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{const r=JSON.parse(s);console.log({protocol:r.protocol,statusCode:r.statusCode,hasLocation:!!(r.header&&r.header.location),error:r.error&&r.error.code})})'
   ```

   外层必须为 HTTP 200，不能带 HTTP `Location` 或 `Set-Cookie`；JSON 中应有协议标记和学校的 302/跳转地址。上面的命令只打印状态与跳转是否存在，不打印 SSO 参数或 Cookie。

6. 重新编译小程序，先测试登录入口，再用本人账号验证课表和考勤。真机保持合法域名和 HTTPS 校验开启，request 合法域名包含 `https://slai-api.wangfaye.cn`。更新客户端必须与新接口部署配套；旧网关返回 404/HTML 时会显示“代理登录接口尚未部署或版本不匹配”。

## 协议与会话

客户端只向 `https://slai-api.wangfaye.cn/_slai/relay` 发送 POST JSON，学校目标 URL、原始 GET/POST、Cookie 和表单正文放在 JSON 中。服务端只允许三个学校 HTTPS 域名和标准 443 端口，复用路径校验，拒绝点段与编码分隔符。学校查询串保持原样。

微信工具会自动给传输 URL 添加 `?_wx_redirect=manual`。服务端按原始路径匹配入口，忽略外层查询参数；学校 URL 只取自校验后的 JSON，外层参数不会混入学校的查询串。

服务端每次只请求一个上游，不跟随重定向，保留独立 Set-Cookie 行；响应只携带 Location、Set-Cookie、Content-Type。小程序按学校逻辑域维护内存 Cookie，302/303 后移除 POST 正文，阻止跨域保留 POST 的 307/308。服务端无 Cookie 仓库、账号存储或逐请求日志，不共享不同用户会话。

请求最多 256 KiB，解压后响应最多 4 MiB，上游总超时 20 秒，连接关闭时取消上游请求。直连学校的 Node HTTPS 模式始终验证证书；若中转主机不信任学校证书，会返回 `UPSTREAM_TLS_ERROR`。应修复证书链，或在核实后通过 Node 的 `NODE_EXTRA_CA_CERTS` 配置信任的学校 CA，不能关闭校验。FRP 模式复用已有通道与校园网关，不改变其证书配置。不得导出含密码、Cookie 或完整 SSO 地址的调试日志。

单改 Nginx `proxy_redirect` 只会改写响应头中的跳转地址，不能保证小程序收到每一跳及按原学校域隔离 Cookie。相关行为见 [Nginx 官方说明](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_redirect)；服务端上游使用 [Node HTTPS 请求](https://nodejs.org/api/https.html#httpsrequesturl-options-callback)。

## 验证边界

本地回归测试覆盖实际 HTTP 中转响应、小程序默认传输、登录多次跳转、Cookie 隔离、跨域 POST 拦截、路径拒绝和错误分类。学校上游在这些测试中使用虚构响应；另已完成微信模拟器真实业务验证，用户已确认新域名的手机连接检查和登录成功。此次真机课表、考勤同步未单独确认，也尚未覆盖其他手机平台及会话续期场景。
