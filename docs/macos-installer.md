# macOS 双击安装包

## 使用

1. 选择 Apple 芯片（arm64）或 Intel（x64）的 `.pkg`，双击，按 macOS 安装向导完成安装。
2. 打开「访达 → 应用程序 → dotjar」。第一次会准备个人程序目录，然后打开网页；以后继续双击这个应用。
3. 网页中的「更新」管理 dotjar 程序更新。默认不会开启登录自启，也不会自动安装新版。

当前构建文件名带 `unsigned-test`，仅为未公证测试版。内嵌 dotjar 程序仍验证自身的 Ed25519 签名，但这不等于 Apple Developer ID 签名和公证。下载后可能被 Gatekeeper 拦截；只对确认来自本项目的测试包，在系统设置的「隐私与安全性」中手动允许打开，不需要关闭系统安全保护。

自带 Node.js，机器无需另装 Node、npm 或 Git。程序首次初始化不需联网下载；使用 Claude/Codex CLI 或模型 API 进行打捞仍需相应配置和访问条件。此次不包含模型客户端和账号。

## 安装位置和已有数据

- `.pkg` 只安装 `/Applications/dotjar.app`，没有以 root 执行用户代码的安装脚本。
- 首次双击以当前用户身份验证内嵌正式发布包，在 `~/.local/share/dotjar` 建立托管安装。稳定启动器和独立 Node 副本留在这个目录，移动或移除 `.app` 不会破坏后台运行环境。Node 许可证一并保留。
- 默认沿用 `~/.dotjar`，只有旧 `~/.strata` 存在时继续沿用它。已有托管安装以 `installation.json` 中的数据路径和运行环境为准，重复打开不覆盖、不降级，也不切换原来使用的 Node。
- 现有程序正在运行时直接复用。旧源码安装有登录启动项但没有运行时，需要先取消旧版自启，避免两个版本抢占同一份数据。
- 如果 `~/.local/bin/dotjar` 不存在，会创建命令行入口；已有同名文件或符号链接不会被覆盖。
- 初始化失败会移除本次暂存文件，不删除用户数据。已有不完整安装会报告错误，保留现场，不把整个目录当作可清理垃圾。

关闭浏览器或移除 `.app` 不会停止已经启动的后台服务。需要卸载时，先执行：

```sh
~/.local/bin/dotjar service uninstall &&
~/.local/bin/dotjar stop
```

然后将「应用程序」中的 dotjar 移到废纸篓。若要移除个人程序文件，可删除 `~/.local/share/dotjar` 和 `~/.local/bin/dotjar`；**不要删除 `~/.dotjar` 或旧 `~/.strata`，除非确实要清空记录和设置**。当前仍需命令行停止/卸载后台服务，图形卸载入口尚未实现。

## 构建与验证

需要 macOS 和 Xcode Command Line Tools。程序版本必须已经在 GitHub 发布签名附件；安装包构建会下载并验证该版本，不把未发布的源码当作内嵌程序。

```sh
node scripts/package-macos.js --version=0.4.2 --arch=arm64
node scripts/smoke-macos.js dist/macos/arm64/dotjar.app
# Intel 包可交叉构建；实际运行需在 Intel 或具备 Rosetta 的 Mac 上验证。
node scripts/package-macos.js --version=0.4.2 --arch=x64
```

产物在 `dist/macos/<arch>/`，含 `.pkg`、SHA-256 文件和供独立测试用的 `.app`。测试模式给应用做 ad-hoc 签名以支持 Apple 芯片执行，安装包仍无 Developer ID 签名/公证。CI 的 `macOS installer (test)` 工作流会构建两种架构并上传测试产物，该测试工作流不附加到稳定 Release；版本发布流水线会把明确标为 `unsigned-test` 的安装包附加到对应 Release；只有运行器架构匹配时执行运行测试。

Node 版本和两个架构的官方压缩包 SHA-256 固定在 `packaging/macos/node-runtime.json`，从 `nodejs.org` 下载，解压前验证。更新运行环境版本时必须核对并同步这份清单。应用图标和品牌图由 `packaging/macos/render-brand.swift` 生成，蓝色四角星和衬线字源自用户提供的视觉参考；在 macOS 执行 `xcrun swift packaging/macos/render-brand.swift assets` 可重建。

自动测试覆盖：离线验签与损坏包拒绝、暂存失败重试、活跃安装/更新互斥、保留已有版本与数据路径、不覆盖不完整安装。独立运行测试以受限 PATH 和临时用户目录启动真实内嵌 Node，验证首次安装、重复打开不启动第二份服务、稳定运行环境重启及笔记保留。

## Apple 签名和公证

正式构建需要付费 Apple Developer 账号、可用的 Developer ID Application 和 Developer ID Installer 证书，以及已保存的 `notarytool` Keychain profile。不要把证书私钥或账号口令提交到仓库。

```sh
export DOTJAR_APP_SIGN_ID='Developer ID Application: …'
export DOTJAR_INSTALLER_SIGN_ID='Developer ID Installer: …'
export DOTJAR_NOTARY_PROFILE='dotjar-notary'
node scripts/package-macos.js --version=0.4.2 --arch=arm64 --signed
```

正式模式依次签署内嵌 Node 和应用（Hardened Runtime）、签署安装包、提交公证、附加公证票据并进行 Gatekeeper 检查。任何必需配置缺失或检查失败都会中止，不降级为测试包。当前没有开发者证书，**此流程尚未完成真实签名和公证验证**。

网页更新只更新 dotjar 发布代码，不更新 `.app`、稳定启动器或 Node。已有安装的运行环境迁移仍需另行处理，不能声称安装新版 `.pkg` 就替换了旧后台 Node。正式面向客户分发前还需要补足这部分维护流程，以及不同 macOS 版本、Intel 实机、下载隔离属性和全新账号的端到端验证。
