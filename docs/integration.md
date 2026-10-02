# 学校系统接入

当前小程序通过 `https://slai-api.wangfaye.cn/_slai/relay` 登录学校账号，读取课表、月度考勤和闸机记录，支持演示模式与离线缓存。手机连接和登录已由用户确认；详细验收边界见[验证记录](login-verification.md)，服务器维护见[中转部署](relay-deployment.md)。

## 请求链路

小程序 → 公网 HTTPS Nginx → Node JSON 中转 → FRP visitor → 校园侧网关 → SIS / STS / STU。

学校的状态码、Location 和 Set-Cookie 放在 JSON 响应内，由小程序逐跳处理。这样微信不会自动跳转到学校 HTTPS 域名。客户端的公网请求固定发往新中转入口；`openslai.cn` 保留为校园网关 Host 与旧跳转的逻辑别名，不应全局替换。

| 模块 | 职责 |
| --- | --- |
| `services/login-probe.js` | 学校认证、跳转校验、内存 Cookie 隔离与旧代理地址兼容 |
| `services/relay-protocol.js` | 公网入口、JSON 协议、响应校验及连接错误分类 |
| `server/relay.js` | 校验目标并执行单次上游请求，不跟随重定向 |
| `services/campus.js` | 课表、按月考勤、闸机明细同步与会话恢复 |
| `services/campus-data.js`、`punches.js` | 学校数据转换、闸机分页与完整性检查 |
| `services/store.js`、`login-cache.js` | 本机业务缓存与可选的加密凭据存储 |

客户端模块均位于 `miniprogram/` 下。学校接口适配参考 [wangjt23/SLAIer-APP](https://github.com/wangjt23/SLAIer-APP)，不依赖 WebView Cookie 或网页脚本注入。

## 会话与数据

- Cookie 仅驻留内存。「记住登录」默认开启，学校认证和课表校验成功后才用微信加密存储保存凭据；不支持加密时提示失败，不降级为明文存储。
- 冷启动按需认证；会话失效后最多自动重登一次。凭据被学校拒绝时清除已保存登录，网络错误保留凭据。退出、清除数据或显式换账号会取消原会话并清除凭据。
- 按月同步仅替换对应月份；考勤失败保留已成功的课表和旧月份数据。显式换账号后，首次成功保存课表时清除前一账号的考勤缓存。
- 今日时长由学院进出记录估算，忽略宿舍；历史时长和达标状态以学校汇总为准，详见[今日时长](live-attendance.md)。

## 安全边界

账号、密码、Cookie 和 SSO 参数会经过自管中转链路，代理不得记录或持久化这些内容。服务端只接受 SIS、STS、STU 的 HTTPS 目标及标准 443 端口，拒绝路径点段、编码分隔符和未知目标。Cookie 按学校逻辑域隔离，跨域 307/308 不保留密码 POST。

无密码连接检查使用独立匿名会话，不复用用户 Cookie、不写业务缓存。复制的 ND-3 报告仅含固定错误分类、格式受限的 AppID、运行环境和设备版本等诊断信息，不含原始错误文本或认证内容。保持微信合法域名和 HTTPS 校验开启，不导出未经脱敏的网络日志。

尚未实现 MFA、图片验证码、学校端会话撤销或后台定时同步；不认识的认证流程会停止。长期自动重登和更多手机平台仍需实测，不应把单次登录成功视为这些能力已经验证。
