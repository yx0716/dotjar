# dotjar

[中文](README.md) | English

> 维天有汉，鉴亦有光。 “The sky has its river of stars; look into it, and it too gives light.” — *Book of Songs*

After a day of working with AI agents, dotjar lays the day out as a river of stars: it shows where you could have worked with the agent more smoothly, and brings up the strategies, lessons and blind spots worth keeping, one star at a time, into a jar.

![dotjar](docs/en/veil.png)

## Run it

```bash
npx github:yx0716/dotjar
```

Needs Node 20 or newer, nothing else, and no account. The page opens in your browser; the server listens on `127.0.0.1` only. To see what it looks like without reading anything from your machine:

```bash
npx github:yx0716/dotjar demo
```

## Three things it gives you

- **Craft**: it points at the sentence in today's conversations that left the agent guessing and cost you rounds, and gives you wording you can use as is next time.
- **What the work taught**: judgement that carries to the next project, in three kinds: a way of going at a kind of problem (strategy), a judgement the work earned (lesson), a case that is easy to leave out (blind spot). One card at a time, keep or skip; what you keep is plain Markdown.
- **How you are getting on**: one specific thing you did well and actions the model matched to earlier keepers. Check a feedback row to tuck it away in a small burst of starlight; expand it again whenever you like. Checking acknowledges reading, not agreement with the model.

![A card](docs/en/card.png)

## Breaks

It can ask you to step away for a few minutes every so often. Off by default; you set how often. As the break runs out it shows what you and the agents did in the stretch before it: what an agent is still running, what is waiting on you, what is wrapped up. A busy day no longer ends with nothing to say for it.

![A break](docs/en/rest.png)

## What it reads, and who reads it

Conversation records from Claude Code, Codex, Cursor, Gemini CLI, Qwen Code, opencode, OpenClaw and others are read locally. For a catch, excerpts containing your messages and each turn's closing reply are sent to your selected model service through the local `claude` or `codex` command, or a configured OpenAI-compatible endpoint. Break recaps read the local records without calling a model.

## Updates

Signed update packages are supported from v0.4.0. Managed installation downloads the latest stable GitHub Release.

Managed installation supports macOS with Node 20 or newer. Existing users should stop the old service first; new users can run this directly:

```bash
# Use dotjar service uninstall for a login service, otherwise dotjar stop
npx --yes github:yx0716/dotjar#v0.4.0 install-managed
```

Add `~/.local/bin` to PATH and use its `dotjar` command from then on. Run `dotjar service install` again if you want login startup. Existing settings, ledgers and notes stay in place; source checkouts are never overwritten. Older versions without this command need a one-time manual upgrade first.

Open **Updates** in the page to check versions, read release notes and choose **Update & restart**. Daily checks are optional and off by default; installation is always explicit. The updater verifies signatures, waits for ongoing work and breaks, and restores the previous version if the new service fails to start. CLI equivalents:

```bash
dotjar update check
dotjar update install
dotjar update status
```

See [installation, migration and publishing](docs/updates.md) (Chinese) for details. Scheduled catches and per-run consumption display remain design proposals and are not implemented in this release.

## With a desktop pet

The crab in [clawd-insights](https://github.com/yx0716/clawd-insights) fishes for stars with you.

## More

Keys, settings, the command line, running from source and known limits are in the [guide](docs/guide.en.md).

## License

MIT
