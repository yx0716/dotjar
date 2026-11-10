# dotjar

中文 | [English](README.en.md)

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
- **成长**：今天做得好的一件具体的事，之前留下的哪一条今天用上了，罐子里已经攒了多少颗。

![一张卡片](docs/card.png)

## 歇一歇

可以让它每隔一段时间请你歇几分钟，默认关，间隔自己定。歇到最后，它给你看刚才这一段你和 agent 各做了什么：哪件 agent 还在跑，哪件在等你回话，哪件已经收尾。忙了一天，不至于说不出自己做了什么。

![歇一歇](docs/rest.png)

## 读什么，交给谁

读本机 Claude Code、Codex、Cursor、Gemini CLI、Qwen Code、opencode、OpenClaw 等的对话记录，只看你说的话和 agent 每轮的收尾，不上传。打捞交给你本机的 `claude` 或 `codex` 命令，装了哪个用哪个，也可以接任何 OpenAI 兼容的接口。歇一歇的回顾直接读记录，不经过模型。

## 配个桌宠

[clawd-insights](https://github.com/yx0716/clawd-insights) 里的小螃蟹会陪你一起捞星星。

## 更多

快捷键、配置项、命令行、从源码运行和已知的边界，见[使用说明](docs/guide.md)。

## 许可证

MIT
