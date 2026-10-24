# dotjar

[中文](README.md) | English

After a day of working with AI agents, dotjar picks out the ways of thinking worth keeping and drops them, one at a time, into a jar.

![dotjar](docs/en/veil.png)

## Run it

Needs Node 20 or newer, nothing else.

```bash
npm start
```

The page opens in your browser; the server listens on `127.0.0.1` only. To have it start at login, run `npm run service` once.

## What it does

- **Today**: each question you asked is a grey speck, the day a trickle from morning to night; beside each thing you worked on hang the coloured dots it turned up.
- **Worth keeping**: one card at a time, keep or skip. What it keeps are ways of looking at problems and trade-offs you made, not facts you looked up.
- **Library**: what you kept is plain Markdown, gathered into one searchable page.
- **Calendar**: tick earlier days to go through them too.

## What it reads, and who reads it

The conversation records on this machine from Claude Code, Codex, Cursor, Gemini CLI, Qwen Code, opencode, OpenClaw and others: only what you said and each turn's closing message, never uploaded. The day is gone through by your local `claude` or `codex` command, or any OpenAI-compatible endpoint.

## With a desktop pet

The crab in [clawd-insights](https://github.com/yx0716/clawd-insights) picks up the dots with you.

## More

Keys, settings, the command line and known limits are in the [guide](docs/guide.en.md).

## License

MIT
