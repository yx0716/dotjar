"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const sources = require("../src/core/sources");
const { decodeDashedPath } = require("../src/core/agents");

const win = sources.dayWindow(new Date(2026, 5, 10, 12, 0, 0), 4);
const at = (h, m = 0) => new Date(2026, 5, 10, h, m, 0);

function write(file, text, when = at(11)) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  fs.utimesSync(file, when, when);
}
const jsonl = (records) => records.map((r) => JSON.stringify(r)).join("\n") + "\n";

// A home folder holding one conversation from each agent, all from the same day.
function fakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-agents-"));
  const repo = path.join(home, "work", "my-app");
  fs.mkdirSync(repo, { recursive: true });

  write(
    path.join(home, ".cursor", "projects", repo.split(path.sep).filter(Boolean).join("-"), "agent-transcripts", "c1", "c1.jsonl"),
    jsonl([
      { role: "user", message: { content: [{ type: "text", text: "<user_query>\n这段是什么意思\n</user_query>" }] } },
      { role: "assistant", message: { content: [{ type: "text", text: "我先读一下。\n\n[REDACTED]" }, { type: "tool_use", name: "Read", input: {} }] } },
      { role: "assistant", message: { content: [{ type: "text", text: "它在说两处装配逻辑重复了。" }] } },
      { type: "turn_ended", status: "success" },
    ])
  );

  write(
    path.join(home, ".openclaw", "agents", "main", "sessions", "o1.jsonl"),
    jsonl([
      { type: "session", id: "o1", timestamp: at(9).toISOString(), cwd: repo },
      { type: "model_change", timestamp: at(9).toISOString() },
      { type: "message", timestamp: at(9, 1).toISOString(), message: { role: "user", content: [{ type: "text", text: "整理一下今天的待办" }] } },
      { type: "message", timestamp: at(9, 2).toISOString(), message: { role: "assistant", content: [{ type: "toolCall", name: "read" }, { type: "text", text: "整理好了，三件事。" }] } },
      { type: "message", timestamp: new Date(2026, 5, 9, 9).toISOString(), message: { role: "user", content: [{ type: "text", text: "昨天的" }] } },
    ])
  );
  // A timer that asks the same thing all day is not work.
  write(
    path.join(home, ".openclaw", "agents", "main", "sessions", "heartbeat.jsonl"),
    jsonl([
      { type: "session", id: "hb", cwd: repo },
      ...Array.from({ length: 12 }, (_, i) => [
        { type: "message", timestamp: at(5, i).toISOString(), message: { role: "user", content: [{ type: "text", text: "Read HEARTBEAT.md if it exists." }] } },
        { type: "message", timestamp: at(5, i).toISOString(), message: { role: "assistant", content: [] } },
      ]).flat(),
    ])
  );

  write(path.join(home, ".gemini", "projects.json"), JSON.stringify({ projects: { [repo]: "my-app-hash" } }));
  write(
    path.join(home, ".gemini", "tmp", "my-app-hash", "chats", "session-1.json"),
    JSON.stringify({
      sessionId: "g1",
      messages: [
        { type: "user", content: "解释这个正则", timestamp: at(13).toISOString() },
        { type: "info", content: "ignored" },
        { type: "gemini", content: [{ text: "它匹配行首的日期。" }], timestamp: at(13, 1).toISOString() },
      ],
    })
  );
  write(
    path.join(home, ".qwen", "tmp", "unmapped", "chats", "session-2.json"),
    JSON.stringify({ sessionId: "q1", messages: [{ type: "user", text: "写个排序" }, { type: "gemini", text: "写好了。" }] })
  );

  const oc = path.join(home, ".local", "share", "opencode", "storage");
  write(path.join(oc, "session", "p", "ses_1.json"), JSON.stringify({ id: "ses_1", directory: repo, title: "修登录", time: { created: at(14).getTime(), updated: at(14, 5).getTime() } }));
  write(path.join(oc, "message", "ses_1", "msg_1.json"), JSON.stringify({ id: "msg_1", role: "user", time: { created: at(14).getTime() } }));
  write(path.join(oc, "message", "ses_1", "msg_2.json"), JSON.stringify({ id: "msg_2", role: "assistant", time: { created: at(14, 1).getTime() } }));
  write(path.join(oc, "part", "msg_1", "prt_1.json"), JSON.stringify({ id: "prt_1", type: "text", text: "登录后跳错页了" }));
  write(path.join(oc, "part", "msg_2", "prt_1.json"), JSON.stringify({ id: "prt_1", type: "tool", tool: "edit" }));
  write(path.join(oc, "part", "msg_2", "prt_2.json"), JSON.stringify({ id: "prt_2", type: "text", text: "回调地址写反了，已改。" }));

  // An agent that writes Claude Code's format under its own folder.
  write(
    path.join(home, ".codebuddy", "projects", "p", "b1.jsonl"),
    jsonl([
      { type: "user", uuid: "b-u1", timestamp: at(15).toISOString(), origin: { kind: "human" }, cwd: repo, message: { role: "user", content: "加个导出按钮" } },
      { type: "assistant", uuid: "b-a1", timestamp: at(15, 1).toISOString(), message: { model: "m", content: [{ type: "text", text: "加好了。" }] } },
    ]),
    at(15, 1)
  );
  return { home, repo };
}

test("every local agent's conversations are read, not only Claude Code's", async () => {
  const { home, repo } = fakeHome();
  const day = await sources.collectDay({
    window: win,
    claudeDir: path.join(home, ".claude"),
    codexDir: path.join(home, ".codex"),
    agentHome: home,
    home,
  });
  const got = Object.fromEntries(day.sessions.map((s) => [s.agent, s]));
  assert.deepEqual(Object.keys(got).sort(), ["codebuddy", "cursor", "gemini-cli", "openclaw", "opencode", "qwen-code"]);

  const turns = (agent) => got[agent].turns.map((t) => [t.user, t.reply]);
  assert.deepEqual(turns("cursor"), [["这段是什么意思", "它在说两处装配逻辑重复了。"]]);
  assert.deepEqual(turns("openclaw"), [["整理一下今天的待办", "整理好了，三件事。"]]);
  assert.deepEqual(turns("gemini-cli"), [["解释这个正则", "它匹配行首的日期。"]]);
  assert.deepEqual(turns("qwen-code"), [["写个排序", "写好了。"]]);
  assert.deepEqual(turns("opencode"), [["登录后跳错页了", "回调地址写反了，已改。"]]);
  assert.deepEqual(turns("codebuddy"), [["加个导出按钮", "加好了。"]]);

  // Wherever the agent says which folder it worked in, the project is that folder.
  for (const agent of ["cursor", "openclaw", "gemini-cli", "opencode", "codebuddy"]) assert.equal(got[agent].project, "work/my-app", agent);
  assert.equal(got["qwen-code"].project, "unmapped");
  assert.equal(got.opencode.title, "修登录");
  assert.equal(decodeDashedPath(repo.split(path.sep).filter(Boolean).join("-")), repo);
  assert.equal(decodeDashedPath("no-such-folder-anywhere"), "");
});

test("without a home for other agents, only Claude Code and Codex are read", async () => {
  const { home } = fakeHome();
  const day = await sources.collectDay({ window: win, claudeDir: path.join(home, ".claude"), codexDir: path.join(home, ".codex"), home });
  assert.deepEqual(day.sessions, []);
});

test("before any work today, the day to look at is yesterday", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-yday-"));
  process.env.DOTJAR_HOME = path.join(home, "data");
  const dotjar = require("../src/core/dotjar");
  const cfg = { ...require("../src/core/config").load(), claudeDir: path.join(home, ".claude"), codexDir: path.join(home, ".codex"), agentHome: home };
  const file = path.join(cfg.claudeDir, "projects", "p", "s.jsonl");
  write(file, jsonl([{ type: "user", uuid: "y1", timestamp: at(15).toISOString(), origin: { kind: "human" }, cwd: "/w/p", message: { role: "user", content: "昨天问的" } }]), new Date(2026, 5, 11, 8));

  // The same afternoon it is today's work.
  const sameDay = await dotjar.scan(cfg, new Date(2026, 5, 10, 18));
  assert.deepEqual([sameDay.window.key, sameDay.daysBack, sameDay.sessions.length], ["2026-06-10", 0, 1]);
  // The next morning, with nothing done yet, it is still the day to go through.
  const nextMorning = await dotjar.scan(cfg, new Date(2026, 5, 11, 9));
  assert.deepEqual([nextMorning.window.key, nextMorning.daysBack, nextMorning.sessions.length], ["2026-06-10", 1, 1]);
  assert.equal(dotjar.view(cfg, nextMorning).daysBack, 1);
  // Two days on there is nothing to fall back to.
  const later = await dotjar.scan(cfg, new Date(2026, 5, 12, 9));
  assert.deepEqual([later.window.key, later.daysBack, later.sessions.length], ["2026-06-12", 0, 0]);
});

test("yesterday stays reachable once today has work of its own", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-both-"));
  process.env.DOTJAR_HOME = path.join(home, "data");
  const dotjar = require("../src/core/dotjar");
  const ledger = require("../src/core/ledger");
  const cfg = { ...require("../src/core/config").load(), claudeDir: path.join(home, ".claude"), codexDir: path.join(home, ".codex"), agentHome: home };
  const ask = (uuid, when, text) => ({ type: "user", uuid, timestamp: when.toISOString(), origin: { kind: "human" }, cwd: "/w/p", message: { role: "user", content: text } });
  write(path.join(cfg.claudeDir, "projects", "p", "s.jsonl"), jsonl([ask("d1", at(15), "昨天问的"), ask("d2", new Date(2026, 5, 11, 9), "今天问的")]), new Date(2026, 5, 11, 9));
  ledger.saveDay(ledger.applyDistilled(ledger.loadDay("2026-06-10"), [{ id: "a", kind: "note", title: "昨天的候选", payoff: "", projects: [], draft: "x" }], { at: 1 }));

  const now = new Date(2026, 5, 11, 10);
  const today = await dotjar.scan(cfg, now);
  assert.deepEqual([today.window.key, today.daysBack, today.sessions[0].turns[0].user], ["2026-06-11", 0, "今天问的"]);
  assert.deepEqual(dotjar.view(cfg, today).earlier, { day: "2026-06-10", open: 1 });
  // Yesterday's undecided candidate is in today's list, marked with its day.
  assert.deepEqual(dotjar.view(cfg, today).candidates.map((c) => [c.title, c.day]), [["昨天的候选", "2026-06-10"]]);

  const back = await dotjar.scan(cfg, now, { daysBack: 1 });
  assert.deepEqual([back.window.key, back.daysBack, back.sessions[0].turns[0].user], ["2026-06-10", 1, "昨天问的"]);
  assert.equal(dotjar.view(cfg, back).candidates[0].title, "昨天的候选");
  assert.equal(dotjar.view(cfg, back).earlier, null);
});

test("any recent day can be asked for by date", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-pick-"));
  process.env.DOTJAR_HOME = path.join(home, "data");
  const dotjar = require("../src/core/dotjar");
  const ledger = require("../src/core/ledger");
  const cfg = { ...require("../src/core/config").load(), claudeDir: path.join(home, ".claude"), codexDir: path.join(home, ".codex"), agentHome: home };
  const ask = (uuid, when, text) => ({ type: "user", uuid, timestamp: when.toISOString(), origin: { kind: "human" }, cwd: "/w/p", message: { role: "user", content: text } });
  write(path.join(cfg.claudeDir, "projects", "p", "s.jsonl"), jsonl([ask("p1", new Date(2026, 5, 8, 11), "三天前问的"), ask("p2", new Date(2026, 5, 11, 9), "今天问的")]), new Date(2026, 5, 11, 9));
  const now = new Date(2026, 5, 11, 10);

  const then = await dotjar.scan(cfg, now, { day: "2026-06-08" });
  assert.deepEqual([then.window.key, then.daysBack, then.sessions[0].turns[0].user], ["2026-06-08", 3, "三天前问的"]);
  // A day that has not happened is not a thing to look at.
  assert.equal((await dotjar.scan(cfg, now, { day: "2026-06-20" })).window.key, "2026-06-11");

  assert.equal(dotjar.view(cfg, then).todayKey, "2026-06-11");

  // The calendar: which days of the month had work, and what is known of each.
  const june = await dotjar.calendar(cfg, "2026-06", now);
  assert.equal(june.days.length, 30);
  const day = (key) => june.days.find((d) => d.day === key);
  assert.deepEqual([day("2026-06-08").asks, day("2026-06-11").asks, day("2026-06-09").asks], [1, 1, 0]);
  assert.deepEqual([day("2026-06-08").seen, day("2026-06-09").seen], [true, false], "only days that were opened have a ledger");
  assert.deepEqual([day("2026-06-11").future, day("2026-06-12").future], [false, true]);
  const may = await dotjar.calendar(cfg, "2026-05", now);
  assert.ok(may.days.every((d) => d.asks === 0));
  await assert.rejects(dotjar.calendar(cfg, "June"), /2026-10/);
  assert.deepEqual(ledger.recentDays("2026-06-11", 2).map((d) => [d.day, d.seen]), [["2026-06-11", true], ["2026-06-10", false]]);
});

test("an undated Cursor transcript counts only toward the day it began or was last written", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-cursor-day-"));
  const file = path.join(home, ".cursor", "projects", "x", "agent-transcripts", "c", "c.jsonl");
  write(file, jsonl([{ role: "user", message: { content: "<user_query>问一句</user_query>" } }]), new Date(2026, 5, 12, 10));
  const read = async (key) => (await sources.collectDay({ window: sources.windowForKey(key, 4), claudeDir: path.join(home, ".claude"), codexDir: path.join(home, ".codex"), agentHome: home, home })).sessions.length;
  // Last written on the 12th: that is its day; the 10th and 11th are not.
  assert.deepEqual([await read("2026-06-10"), await read("2026-06-11"), await read("2026-06-12")], [0, 0, 1]);
});
