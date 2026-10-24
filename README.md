# dotjar

中文 | [English](README.en.md)

和 AI agent 一起干完一天的活，dotjar 把其中值得长期留下的思考方式挑出来，一颗一颗放进罐子里。

![dotjar](docs/veil.png)

## 用起来

需要 Node 20 或更新版本，没有别的依赖。

```bash
npm start
```

页面会在浏览器里打开，服务只开在本机 `127.0.0.1` 上。想登录时自动启动，再跑一次 `npm run service`。

## 它做什么

- **今天**：你的每次提问是一个小灰点，从早到晚连成一条细流；每件事旁边挂着从中捡到的彩色波点。
- **待落库**：一次一张卡片，留下或略过。留下的是看问题的方式和做过的取舍，不是查来的知识点。
- **库存**：留下的都是普通 Markdown，汇成一个能搜索的网页。
- **日历**：勾选往日，补着整理。

## 读什么，交给谁

读本机 Claude Code、Codex、Cursor、Gemini CLI、Qwen Code、opencode、OpenClaw 等的对话记录，只看你说的话和 agent 每轮的收尾，不上传。整理交给你本机的 `claude` 或 `codex` 命令，也可以接任何 OpenAI 兼容的接口。

## 配个桌宠

[clawd-insights](https://github.com/yx0716/clawd-insights) 里的小螃蟹会陪你一起捡波点。

## 更多

快捷键、配置项、命令行和已知的边界，见[使用说明](docs/guide.md)。

## 许可证

MIT
