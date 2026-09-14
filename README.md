# 河套日常

面向河套学院的非官方校园生活小程序，使用微信原生 JavaScript / WXML / WXSS 开发。

> 小程序正在等待备案审核。

## 功能

- **日常**：今日在校估算、出勤状态、打卡记录、下一节课与个人目标。
- **课表**：月历查看课程，支持教学周、单双周和 `.ics` 导出。
- **考勤**：按月同步、每日汇总、打卡明细与未达标记录。
- **个人管理**：年假账本、请假估算、课程冲突检查与日程。
- **登录与缓存**：学校账号登录、可选加密记住登录，课表和考勤支持离线查看。

## 运行

1. 使用微信开发者工具导入项目，无需安装依赖或构建。
2. 将 `project.config.json` 中的 AppID 替换为自己的，并在小程序后台配置 request 合法域名：`https://sis.slai.edu.cn`、`https://sts.slai.edu.cn`、`https://stu.slai.edu.cn`。
3. 选择「普通编译」。首次打开可浏览演示数据，登录学校账号后同步真实数据；访问考勤需校园网或可访问学校的 VPN。

运行本地测试：`npm test`（需 Node.js）。

## 说明

今日时长按学院多次进出记录累计，忽略宿舍，在校时持续估算；历史考勤与达标状态以学校汇总为准。年假账本为个人记录，不同步学校余额。核心登录链路已通过真机验证，主页面完整同步仍待真机验收，尚未发布正式版。

更多细节：[今日时长](docs/live-attendance.md) · [接入设计](docs/integration.md) · [验证记录](docs/login-verification.md) · [日历与年假](docs/calendar-and-leave.md)

学校接口适配参考 [wangjt23/SLAIer-APP](https://github.com/wangjt23/SLAIer-APP)。本项目采用 [MIT 许可证](LICENSE)。
