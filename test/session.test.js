"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

test("a day that is over is read once per session; a day in progress is read every time", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-session-"));
  process.env.DOTJAR_HOME = path.join(home, "data");
  const config = require("../src/core/config");
  // Everything the session reads is under this folder; none of it is the machine's own records.
  config.save({ claudeDir: path.join(home, ".claude"), codexDir: path.join(home, ".codex"), agentHome: home });
  const { createSession } = require("../src/core/session");

  const file = path.join(home, ".claude", "projects", "p", "s.jsonl");
  const ask = (uuid, when, text) => JSON.stringify({ type: "user", uuid, timestamp: when.toISOString(), origin: { kind: "human" }, cwd: "/w/p", message: { role: "user", content: text } });
  const write = (lines) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.join("\n") + "\n");
  };
  const past = new Date(2026, 5, 10, 15);
  const now = new Date();
  write([ask("a", past, "那天问的"), ask("b", now, "今天问的")]);

  const session = createSession({ language: "zh" });
  assert.equal((await session.today("2026-06-10")).stats.turns, 1);
  assert.equal((await session.today("auto")).stats.turns, 1);

  // More turns up in the transcript, for both days.
  write([ask("a", past, "那天问的"), ask("c", new Date(past.getTime() + 60000), "那天又问的"), ask("b", now, "今天问的"), ask("d", new Date(now.getTime() + 1000), "今天又问的")]);
  // The finished day is answered from what was read the first time, which is
  // what makes going back to it immediate; today is read again.
  assert.equal((await session.today("2026-06-10")).stats.turns, 1);
  assert.equal((await session.today("auto")).stats.turns, 2);
  // What is kept lasts only as long as the session.
  assert.equal((await createSession({ language: "zh" }).today("2026-06-10")).stats.turns, 2);
});
