# dotjar

中文 | [English](README.en.md)

> 维天有汉，鉴亦有光。——《诗经·小雅·大东》

和 AI agent 一起干完一天的活，dotjar 把这一天铺成一条银河：告诉你 agent 哪里可以用得更顺，把值得长期留下的策略、经验和盲点一颗一颗捞起来，装进罐子里。

![dotjar](docs/veil.png)

## 用起来

```bash
npx github:yx0716/dotjar
```

只要有 Node 20 或更新版本，不用装别的，也不用注册。页面会在浏览器里打开，服务只开在本机 `127.0.0.1` 上。想先看看样子、不读本机任何东西：

```bash
npx github:yx0716/dotjar demo
```

## 它给你三样东西

- **用法**：从你今天的对话里指出哪句话让 agent 猜了范围、来回了几轮，再给一段下次可以直接拿去用的说法。
- **认知**：换个项目还用得上的判断，分三种：一类问题的打法（策略）、处理问题得到的判断（经验）、思考时容易漏掉的情况（盲点）。一次一张卡片，收下或略过；收下的是普通 Markdown。
- **成长**：今天做得好的一件具体的事，以及模型发现与过去经验相符的行为。每条反馈都能勾选「看过了」，散成星光后收起；随时可以展开恢复。勾选只表示已读，不代表认可模型的判断。

首页只展开时间、事情名称和星数，点开一件事再看你与 agent 各做了什么、存疑点及全部相关星星。宽窗口每组最多显示六件事，窄窗口三件（包括未归类的一组星），更多内容可以翻组查看。成长反馈默认显示两条，其余可展开；折叠不改变已读状态。

![一张卡片](docs/card.png)

## 歇一歇

可以让它每隔一段时间请你歇几分钟，默认关，间隔自己定。歇到最后，它给你看刚才这一段你和 agent 各做了什么：哪件 agent 还在跑，哪件在等你回话，哪件已经收尾。忙了一天，不至于说不出自己做了什么。

![歇一歇](docs/rest.png)

## 读什么，交给谁

在本机读取 Claude Code、Codex、Cursor、Gemini CLI、Qwen Code、opencode、OpenClaw 等的对话记录，提取你说的话和 agent 每轮的收尾。捕捞时，这些摘要会交给你选择的模型服务：通过本机的 `claude`、`codex` 命令，或配置的 OpenAI 兼容接口。歇一歇的回顾只在本地读记录，不经过模型。

## 一边打捞，一边看

开发分支已加入后台捕捞和逐条预览（尚未发布）：已有内容继续可看，完整生成的新卡片会逐颗出现。刷新网页可以接回原任务，不会重捞。新卡片标为「临时结果」，整轮完成后可收下；旧 CLI 不支持流式输出时，会等完整结果。详见[后台捕捞](docs/progressive-catches.md)。

## 捕捞消耗

从 v0.4.2 起支持逐次统计：页面底部显示最近一次消耗，点击可查看所选日期的捕捞记录、模型、耗时和结果。Claude 显示参考费用，Codex 和 OpenAI 兼容接口显示返回的 token 用量；无法取得的显示「消耗暂不可获取」。参考费用不代表订阅额外扣费，也不换算成套餐百分比。失败和重试各自留记录，旧版本的历史消耗不补算。详见[统计口径与边界](docs/usage.md)。

## 版本更新

macOS 双击安装包已提供测试构建：安装后在「应用程序」打开 dotjar，自带 Node.js，首次初始化无需联网下载程序。当前为**未公证测试版**，下载后可能需要在「系统设置 → 隐私与安全性」中手动允许打开；尚不作为免手动放行的正式分发。构建、测试及签名说明见 [macOS 安装包](docs/macos-installer.md)。

下载 v0.4.2 测试安装包：[Apple 芯片](https://github.com/yx0716/dotjar/releases/download/v0.4.2/dotjar-0.4.2-macOS-arm64-unsigned-test.pkg) · [Intel](https://github.com/yx0716/dotjar/releases/download/v0.4.2/dotjar-0.4.2-macOS-x64-unsigned-test.pkg)。

从 v0.4.0 起支持签名更新包。托管安装从 GitHub 最新正式 Release 下载程序。

macOS + Node 20 或更新版本可使用托管安装。已有用户先停止旧服务，新用户直接运行：

```bash
# 登录自启的旧版先运行 dotjar service uninstall；普通后台服务用 dotjar stop
npx --yes github:yx0716/dotjar#v0.4.2 install-managed
```

把 `~/.local/bin` 加入 PATH，以后使用这里的 `dotjar`。需要登录自启时重新运行 `dotjar service install`。原配置、对话台账和笔记保留；源码工作区不会被覆盖。旧版本没有这个命令，需要先手动取得带更新器的版本。

之后在页面右上角「更新」中检查新版、查看更新说明，并点击「更新并重启」。每日检查可选、默认关闭，不会自动安装。升级会验证签名，等待当前工作和休息结束；新版本启动失败会恢复上一版。也可以使用：

```bash
dotjar update check
dotjar update install
dotjar update status
```

完整的安装、迁移、发布和恢复说明见 [安装与更新](docs/updates.md)。可选定时捕捞和账号剩余额度仍未实现。

## 配个桌宠

[clawd-insights](https://github.com/yx0716/clawd-insights) 里的小螃蟹会陪你一起捞星星。

## 更多

快捷键、配置项、命令行、从源码运行和已知的边界，见[使用说明](docs/guide.md)。

## 开发与安装验收

修改代码时运行 `npm run dev`：默认使用演示数据，每个工作树独立保存开发数据，可以和日常安装同时运行。

`npm run verify:install -- --version 0.4.2 --candidate` 会通过 npx 测试当前安装器，并安装指定的签名发布包；不会卸载日常版。验收公开安装器、开启真实数据及模型调用的方法，见[开发与安装验收](docs/development.md)。

## 许可证

MIT
