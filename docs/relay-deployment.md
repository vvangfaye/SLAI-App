# 登录中转部署与维护

当前入口为 `https://slai-api.wangfaye.cn/_slai/relay`。截至 2026-10-02，DNS、HTTPS 和服务均已部署，公网匿名请求及用户手机连接、登录通过；手机课表、考勤同步尚未单独确认，详见[验证记录](login-verification.md)。

## 当前部署

小程序 → 阿里云 `aliyun1` Nginx → 本机 Node → FRP visitor → 校园侧网关 → 学校系统。

| 配置 | 当前值 |
| --- | --- |
| DNS | 腾讯云 DNSPod，`wangfaye.cn` 下的 `slai-api` A 记录指向 `47.97.220.68`，默认线路，TTL 600 秒 |
| 微信 request 合法域名 | `https://slai-api.wangfaye.cn`，不带路径 |
| Node 服务 | `slai-relay.service`，以 `faye` 运行并开机启动，Node.js 22，监听 `127.0.0.1:8787` |
| 部署目录 | `/home/faye/slai-relay/current` 指向发布目录，保留旧版本用于恢复 |
| 上游通道 | `SLAI_RELAY_GATEWAY=http://127.0.0.1:18080`，复用现有 FRP visitor |
| Nginx | `/etc/nginx/conf.d/slai-api.conf`，复用 `/etc/nginx/snippets/slai-relay.conf`，转发至 `127.0.0.1:8787` |
| 证书 | `/etc/nginx/ssl/slai-api.wangfaye.cn.fullchain.pem` 和同目录 `slai-api.wangfaye.cn.key` |

**证书于 2026-12-31 14:59:59（北京时间）到期，当前没有自动续期。** 到期前在腾讯云续期并重新安装完整证书链和私钥，私钥权限保持 `600`，不得进入仓库。`wangfaye.cn` / `www.wangfaye.cn` 的证书不覆盖此子域。

当前模板为 [nginx-api.conf](../server/nginx-api.conf) 和 [nginx-relay.conf](../server/nginx-relay.conf)。80 端口返回 404；只有 HTTPS 的 `/_slai/relay` 接收请求。旧 `openslai.conf` 保留；`openslai.cn` 仍用作校园网关 Host 及旧跳转兼容地址，不应全局替换，也不应加入新的学校上游白名单。

## 更新与恢复

1. 更新前运行 `npm test`。将服务代码及其引用的客户端协议模块放入新的发布目录，保留旧目录后切换 `current`，执行 `sudo systemctl restart slai-relay.service`。不要将本地 HTTP 端口暴露公网。
2. 变更 Nginx 或证书前备份对应文件。运行 `sudo nginx -t`，通过后才执行 `sudo systemctl reload nginx`；等待新工作进程接管，再做下方公网检查。
3. 健康检查或公网检查失败时恢复原发布链接/配置并重新校验、重启或重载。已有 Nginx 备份为 `/etc/nginx/slai-api-backup-20261002T082515Z` 和 `/etc/nginx/slai-relay-backup-20261002T145235`；每次维护仍需新备份。
4. 更改客户端入口或中转协议时，服务器和小程序配套更新。微信后台加入域名后，在开发工具刷新域名信息、重新编译，手机保持域名和 HTTPS 校验开启。

Node 服务无第三方依赖，以 `node server/relay.js` 启动；`SLAI_RELAY_PORT` 可修改本地端口。当前部署必须保留 `SLAI_RELAY_GATEWAY`。仅在 Node 所在主机能直接解析并访问学校网络时才可省略它；直连模式严格验证学校 TLS 证书，必要时通过 `NODE_EXTRA_CA_CERTS` 配置已核实的学校 CA，不能关闭校验。

## 无密码检查

服务器运行 `systemctl status slai-relay.service` 检查进程。访问 `http://127.0.0.1:8787/healthz` 应返回 `{"protocol":"slai-relay-v1","ready":true}`；这只证明服务启动，不证明校园通道可用。

从公网检查首个学校跳转：

```sh
curl --max-time 25 -sS \
  https://slai-api.wangfaye.cn/_slai/relay \
  -H 'Content-Type: application/json' \
  --data '{"protocol":"slai-relay-v1","url":"https://sis.slai.edu.cn/yjsxt/htxylogin","method":"GET","header":{},"data":""}' \
  | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{const r=JSON.parse(s);console.log({protocol:r.protocol,statusCode:r.statusCode,hasLocation:!!(r.header&&r.header.location),error:r.error&&r.error.code})})'
```

外层应为 HTTP 200，不能有 HTTP `Location` 或 `Set-Cookie`；JSON 应带 `slai-relay-v1`、学校 302 状态及跳转地址。命令只打印状态和跳转是否存在，不输出 SSO 参数或 Cookie。完整匿名跳转使用小程序登录页「检查连接（无需密码）」，通过后再由本人登录核对业务数据。

## 协议与安全边界

- 客户端只向固定中转入口发送 POST JSON，学校 URL、原始 GET/POST、Cookie 和表单正文放在 JSON 中。微信自动附加的 `?_wx_redirect=manual` 仅用于匹配外层入口，不转发到学校。
- 服务端只接受三个学校 HTTPS 域名及标准 443 端口，拒绝点段与编码分隔符，保留学校查询串。每次仅请求一个上游，不跟随跳转；响应仅保留 Location、独立 Set-Cookie 行和 Content-Type。
- 小程序按学校逻辑域管理内存 Cookie；302/303 后去掉 POST 正文，阻止跨域保留 POST 的 307/308。服务端无 Cookie 仓库，不共享用户会话。
- 请求最多 256 KiB，解压后响应最多 4 MiB，上游超时 20 秒，客户端断开时取消上游。Nginx 必须关闭访问日志、缓冲、缓存和自动重试；代理链路不记录或持久化账号、密码、Cookie、SSO 参数和业务内容。

JSON 封装用于让小程序自行处理学校跳转；仅改 Nginx `proxy_redirect` 无法保证微信收到每一跳。中转入口返回 404/HTML 或协议不匹配时，小程序会报告中转未部署或版本不匹配，应先检查服务与路由。
