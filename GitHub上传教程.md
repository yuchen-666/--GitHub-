# 新手逐步上传 GitHub

整理日期：2026-10-10。当前仅完成本地整理，尚未上传 GitHub。

## 一、先认准文件夹

只上传这个目录：

`C:\Users\19257\Documents\ChatGPT\西瓜-GitHub上传版`

不要选原来的“西瓜”文件夹。原项目里有真实会员资料、固定密码及旧提交。
上传版是独立副本，原软件、安装包与本机营业数据均未修改。
保留原项目作为你自己的本地资料，不能把原项目整个再复制覆盖到上传版。

## 二、注册账号

1. 浏览器打开 https://github.com/ 。
2. 已有账号就点 Sign in 登录；没有就点 Sign up 注册。
3. 使用自己的邮箱，设置独立密码，按页面完成邮箱验证。
4. 不要把登录密码、短信验证码、恢复码发给别人或助手。
5. 建议在账号安全设置中启用双重验证，并离线保存恢复码。

## 三、安装官方 GitHub Desktop

1. 打开 https://desktop.github.com/ 。
2. 下载 Windows 版本并安装。
3. 启动后选择 Sign in to GitHub.com。
4. 在浏览器完成你自己账号的授权，再返回 Desktop。
5. 如果询问 Git 的姓名与邮箱，这是提交作者信息，不是会员账号；
   希望隐藏私人邮箱时，可以使用 GitHub 提供的 noreply 邮箱。

## 四、把已整理目录加入 Desktop

1. 点击顶部 File → Add Local Repository（添加本地仓库）。
2. 点击 Choose，选择“西瓜-GitHub上传版”文件夹。
3. 本目录已有本地 Git 仓库，直接点击 Add Repository 即可。
4. 若找不到路径，打开 Windows 文件资源管理器，将上面的完整路径
   粘贴到地址栏并回车，确认文件夹内有 README.md、package.json、app 等。
5. 不要选择“西瓜”，也不要选择上一级 ChatGPT 文件夹。

## 五、检查并保存第一次提交

1. 查看左侧 Changes（改动文件）。
2. 可以出现 app、components、lib、db、drizzle、electron/main.cjs、
   package.json、pnpm-lock.yaml、README.md 等源码文件。
3. 不应该出现 node_modules、dist、node.exe、安装包、数据库、日志、
   真实会员名单或密码。如果出现，先停止，不要提交或发布，截图询问。
4. 左下角 Summary 填：整理脱敏源码，首次上传。
5. Description 可留空。
6. 点击 Commit to main（提交到 main）。
7. 如果要求配置姓名/邮箱，用自己的 GitHub 提交身份完成即可。
8. Commit 仅保存在你电脑上，这一步还没上传到互联网。

## 六、发布到 GitHub（必须私有）

1. 点击 Publish repository。
2. Name 填：que-zhuang-local。
3. Description 可填：雀庄会员储值系统单机版源码。
4. 保持 Keep this code private 勾选，意思是私有仓库。
5. Owner 选择自己的账号（如有该项）。
6. 点击 Publish repository，等待完成。
7. 若提示名称已存在，换成 que-zhuang-local-source，不要随意覆盖旧仓库。
8. 如果网络连接失败，不代表程序损坏。不要把密码填进代理网站，
   不要因为上传失败改成 Public；保留本地文件后再排查。

官方操作参考：
https://docs.github.com/en/desktop/adding-and-cloning-repositories/adding-an-existing-project-to-github-using-github-desktop

## 七、确认成功并取得地址

1. 在 Desktop 顶部 Repository 菜单选择 View on GitHub。
2. 浏览器打开后，仓库名旁边应显示 Private。
3. 检查 README、app、lib、electron 等内容是否可见。
4. 地址栏应类似 https://github.com/你的用户名/que-zhuang-local 。
5. 复制这个地址保存。它是源码仓库地址，不是软件在线登录地址。
6. 看到 Private 才说明没有作为公开仓库发布；不是“有链接的人都能看”。

## 八、交给下一任开发者

1. 请对方先提供 GitHub 用户名。
2. 在仓库网页打开 Settings → Collaborators（菜单可能显示访问管理相关名称）。
3. 点击 Add people，输入对方用户名，核对后发送邀请。
4. 对方接受邀请后才能访问私有仓库。
5. 给对方仓库链接与 README，不要发送你的 GitHub 密码。
6. 真实营业数据和部署凭据应走单独的授权渠道，不能写进 Issue、代码或提交。

## 九、以后更新

1. 修改上传版目录中的文件后，打开 Desktop 看 Changes。
2. 每次先检查是否夹带密码或数据。
3. Summary 写本次改动说明，然后 Commit to main。
4. 点击 Push origin 才会同步到 GitHub。
5. 如果其他开发者也改了仓库，先 Fetch origin/Pull origin；
   出现冲突或看不懂的提示先停下，不要随意丢弃文件。
6. 原“西瓜”目录后续发生的改动不会自动进入这个仓库，必须先脱敏再合并。

## 十、几个容易混淆的问题

- 上传源码不等于备份营业数据，也不等于把软件装到别人电脑上。
- 上传源码不需要购买域名、云服务器，也不会自动发布旧网站。
- 现有安装包不能拖到源码列表；它可能含旧初始化密码，不应公开分发。
- 不要把仓库改成 Public，除非另做一次隐私与安全审查。
- 本次没有删除旧 Git 历史，而是上传副本从新的历史开始。
- 本次没有重新打包，不会改变当前安装软件的账号密码和会员余额。

如果卡住，告诉助手“我在第几步”，并发已遮住密码、邮箱和验证码的截图。
