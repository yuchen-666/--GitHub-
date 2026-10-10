# 雀庄会员储值系统（脱敏源码版）

会员管理、共卡昵称识别、折扣结账、余额调整、历史记录及管理员与设备授权。
桌面版本使用 Electron 启动本机 Node/Wrangler 服务，数据保存在本机。

## 此仓库不是什么

- 不是可双击安装的软件；安装包需要另行构建。
- 不含真实会员、余额、营业记录、密码、本机数据库和旧 Git 历史。
- GitHub 存放源码，不会自动运行本系统，也不负责同步会员数据。
- 这是单独整理的源码副本，不会自动同步原项目后续改动。
- 默认空会员列表。不要将它直接用于替换正在营业的数据库或安装目录。

## 技术与目录

- React、TypeScript、Vinext/Vite、Tailwind。
- Electron 桌面壳：`electron/main.cjs`。
- 页面与接口：`app/`；界面组件：`components/`。
- 业务逻辑：`lib/`；数据库结构：`db/`；迁移：`drizzle/`。
- 数据存储沿用 Wrangler/Miniflare 的本地 D1 持久化，并非直接调用原生 SQLite 驱动。

## 开发者运行说明

准备 Windows、Node.js（package.json 要求 >=22.13.0）及 pnpm。
在此目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm build
```

在启动 Electron 的同一个 PowerShell 窗口设置以下环境变量，再执行
`pnpm desktop:dev`：

- AUTH_MANAGER_ACCOUNT
- AUTH_MANAGER_PASSWORD
- AUTH_INITIAL_ADMIN_ACCOUNT
- AUTH_INITIAL_ADMIN_PASSWORD

前两项为管理账号，后两项为普通管理员初始账号。密码自行设置且两者不同，
不要写入源码、截图、提交记录或 GitHub Issues。本源码没有默认密码；
缺失变量会拒绝启动。Electron 不会自动读取 .env 文件。
初始账号仅在数据库没有对应账号时建立；修改环境变量并不会重置已有密码。

打包还需将可信的 Windows x64 Node 运行程序放入
`electron/node-runtime/node.exe`，然后执行 `pnpm desktop:build`。
该运行程序和生成的 dist 安装包都不提交到 Git。
打包版也需要在运行它的本机配置这些环境变量；不会在构建时自动内嵌密码。

## 本地数据与安全

数据路径以 Electron 的 app.getPath('userData') 为准。备份前必须完全退出软件。
仓库不是营业数据备份。不要把数据库、浏览器 Cookie 或日志上传到 GitHub。
本机进程仍可能读取进程环境/启动参数；此整理并不提供硬件级设备认证。
原安装包仍属于旧版本，可能包含固定初始化密码；不要发布到公开 Release。

## 验证范围与已知限制

本次整理检查源码语法、脱敏内容和 OCR 共卡测试；未重新构建安装包，
未验证全新电脑上的完整运行/安装流程，不保证完全断网可用。
OCR 语言包与 rmj.club 等外部依赖需要单独核查。
固定端口 8787、数据库升级、备份恢复和签名等仍需后续完善。
原 lint 存在历史问题，不代表所有检查通过。

.openai/hosting.json 的原项目标识已替换为本地占位值。
它不是有效的云发布配置；云部署须另行配置和测试。
保留原项目的构建依赖，不在本次上传整理中重写技术栈。

## 上传

阅读同目录《GitHub上传教程.md》，默认创建私有仓库。
没有授予开源许可证，请勿把此仓库视作可任意再分发的软件。
