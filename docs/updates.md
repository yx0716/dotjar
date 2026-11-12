# 安装与更新

首版支持 macOS + Node.js 20 或更新版本的网页服务。Electron 源码壳可以查看版本，但不作为托管更新目标。

## 普通用户

不想使用命令行时，可测试 [macOS 双击安装包](macos-installer.md)。它自带运行环境，完成安装后从「应用程序」打开；当前尚未完成 Apple 签名、公证。

页面右上角的「更新」打开版本管理：检查更新、阅读更新说明、跳过版本、更新并重启。每日自动检查是可选项，默认关闭；检查只请求 GitHub 发布信息，不上传对话或笔记。安装始终需要主动点击。

源码 clone/worktree 和旧 npm/npx 安装不会直接覆盖。首次迁移前先停止旧服务（登录自启用 `dotjar service uninstall`，否则用 `dotjar stop`），退出仍在写同一数据目录的旧桌面版本，然后运行带本更新器的新版本命令：

```sh
npx --yes github:yx0716/dotjar#v0.4.2 install-managed
```

旧 npx/npm 版本没有这个子命令，须先手动取得带更新器的版本。安装从 GitHub 最新正式 Release 下载签名包，写入 `~/.local/share/dotjar`，创建 `~/.local/bin/dotjar`；不会覆盖已有的同名命令。确保 `~/.local/bin` 在 PATH 中，以后用这里的 `dotjar`。自定义 `DOTJAR_HOME` 会记录为绝对路径，配置、授权和笔记仍在原处。需要登录自启时，迁移后重新运行 `dotjar service install`。

```sh
dotjar update check
dotjar update status
dotjar update install
```

安装后无需重复迁移。登录启动项指向稳定启动器；Node 的绝对路径固定，移动或删除 Node 后需要修复启动入口，不自动安装系统依赖。

### 卸载

```sh
dotjar uninstall
```

先列出要做的事，确认后才执行：取消登录自启、停止后台服务，删除托管程序（`~/.local/share/dotjar`，含历次版本和运行环境）、`~/.local/bin/dotjar` 和 npx 缓存里的 dotjar。记录、设置和笔记（`~/.dotjar`）保留，重新安装后接着用。加 `--purge` 会把数据目录一起移到废纸篓；笔记目录设在数据目录外时，任何情况下都不会动它。

只删属于这份数据目录的东西：命令入口不是 dotjar 写的、托管安装属于另一个数据目录时，原样保留并在清单里说明。「应用程序」里的 dotjar 和安装包记录需要管理员权限，清单最后会列出要你自己执行的步骤（例如 `sudo pkgutil --forget com.dotjar.installer.arm64`）。正在更新时不能卸载。

旧版本没有这个命令，用 `npx github:yx0716/dotjar uninstall`。后台服务由另一份 dotjar 启动、无法从这里核实身份时，会请启动它的那份程序停止；仍停不下来就不删除任何程序文件，并提示用原入口先停止。

### 0.4.0 安装后提示「程序已安装，启动失败」

此问题已在 0.4.1 修复。0.4.0 的托管后台启动存在进程识别问题：网页服务已启动，安装命令仍可能报告「后台服务没起来」。先运行已有入口打开页面，不要删除安装目录或重复安装：

```sh
~/.local/bin/dotjar
```

如果页面正常打开，安装已成功，数据仍在原处。如果仍打不开，再检查 `~/.dotjar/web.log`（自定义数据目录时查看其中的 `web.log`），不要把所有启动失败都视为误报。

## 升级如何保护现有工作

- 下载先校验内置 Ed25519 公钥签名、发布标签、协议、数据格式和 SHA-256。发布包是有大小上限的 gzip JSON 文件清单，只允许普通文件，不执行安装脚本，也不允许路径穿越、符号链接或大小写重复路径。
- 独立更新进程先等待当前休息结束，再关闭新的写入入口，等待已有操作完成。CLI、网页和 Electron 共享跨进程操作登记；捕捞运行期间不强杀模型进程。等待最多 30 分钟，超时保留当前版本。
- 切换前备份内部配置、台账、收件箱、休息状态和授权；不备份或回滚外部笔记。首版只接受 schema 1 的兼容更新，新服务健康检查完成前不接受业务写入，不执行数据迁移。
- 稳定启动器运行新版；更新进程在原端口、原 token 下核对版本、安装目录、数据目录、schema、静态资源和临时目录写入。失败恢复上一版指针并重启；异常退出或断电后，启动器依据事务记录恢复。
- 更新日志在 `<数据目录>/update.log`；状态在 `<安装目录>/transaction.json`。恢复仍失败时保留写入锁，修复后重启稳定启动器；不要盲目删除锁或内部数据。
- 首版保留下载的版本和备份，不自动清理。重试时会将已有目标版本与重新验签、解包的全部文件逐一比较，完全一致才复用；不一致则拒绝覆盖。暂不自动升级稳定启动器或轮换信任密钥。

## 发布者

正式发布必须包含两个签名附件。推送与 package.json 版本匹配的 tag 后，发布流水线执行测试、构建和上传；仅推送源码不会产生可安装的更新包。

私钥必须留在仓库外。首次生成（已有私钥时不要重新生成）：

```sh
node scripts/release.js keygen
```

默认私钥为 `~/.dotjar-release/signing-key.pem`（0600），公钥在 `assets/update-keys.json`。备份私钥；旧启动器只信任随安装分发的公钥。把私钥配置为仓库 Actions secret `DOTJAR_RELEASE_PRIVATE_KEY`。不要提交私钥、把它复制到发布包，或通过网页接口更换信任根。

### 首次发布操作顺序

1. 完成测试并提交代码，推送工作分支并合入默认分支。同步中英文 README 的安装说明和发布说明。
2. 已有 `~/.dotjar-release/signing-key.pem` 时直接使用，不要再次运行 keygen。备份私钥，然后在有仓库管理权限且已登录的 GitHub CLI 中配置发布 secret（内容不会打印到终端）：

   ```sh
   gh secret set DOTJAR_RELEASE_PRIVATE_KEY --repo yx0716/dotjar < "$HOME/.dotjar-release/signing-key.pem"
   ```

   也可以在仓库 Settings → Secrets and variables → Actions 中添加同名 Repository secret。私钥只能进入这个受控的 secret，不要粘贴到聊天、issue 或提交中。

3. 确认发布版本未被使用，`package.json`、`package-lock.json` 的顶层版本及根包版本一致，并写好 `docs/release-notes.md`。在已合并且工作区干净的提交上创建并推送版本 tag；当前代码版本是 `0.4.2`，tag 必须和最终选定版本一致：

   ```sh
   dotjarReleaseVersion=$(node -p 'require("./package.json").version')
   git tag "v$dotjarReleaseVersion"
   git push origin "v$dotjarReleaseVersion"
   ```

4. 等待 GitHub Actions 的 Signed release 成功，确认 Release 同时包含 `dotjar-update.json` 与 `dotjar-<version>.json.gz`。然后再迁移普通用户安装，验证可从正式 Release 下载。首次安装处于最新版本时，「检查更新」显示已是最新版本是正常的；下一次更高版本发布后才能演练线上跨版本升级。

发布前更新 `package.json` 的稳定版本号、对应 lockfile 元数据和 `docs/release-notes.md`。本地构建：

```sh
DOTJAR_SIGNING_KEY_FILE="$HOME/.dotjar-release/signing-key.pem" node scripts/release.js docs/release-notes.md
```

产物在 `dist/release`：`dotjar-update.json` 和 `dotjar-<version>.json.gz`。GitHub 标签必须是 `v<version>`，附件必须挂在对应正式 Release；不从未发布的分支更新。`.github/workflows/release.yml` 只在推送 tag 时运行测试、构建和发布。普通开发与 PR 不发布。签名更新包发布后，同一流水线会构建并上传 arm64/x64 的双击安装包及 SHA-256 文件；当前安装包明确标为 `unsigned-test`，未完成 Apple 签名公证。已经发布的版本号和附件保持不可变。

## 验证边界

自动测试覆盖签名篡改、不兼容协议/平台、摘要损坏、解包越界、重复路径、下载重定向与大小限制、跨进程写入保护、切换失败、中断恢复，以及两个真实本地网页服务版本的升级和崩溃回退，验证原端口、token 和笔记保持。

未代替真实发布演练：GitHub Release 下载、Actions secret 配置、旧 npm/npx 安装的用户迁移、launchd 登录重启、断电、磁盘满和只读目录仍需在发布前验证。源码工作区不会作为更新演练目标。
