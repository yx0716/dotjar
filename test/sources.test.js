"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const sources = require("../src/core/sources");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-src-"));
}

function jsonl(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

// A window around a fixed afternoon, independent of the machine's clock.
const noon = new Date(2026, 5, 10, 12, 0, 0);
const win = sources.dayWindow(noon, 4);
const at = (h, m = 0) => new Date(2026, 5, 10, h, m, 0).toISOString();

test("a work day rolls over at the configured hour, not at midnight", () => {
  assert.equal(sources.dayWindow(new Date(2026, 5, 11, 3, 0), 4).key, "2026-06-10");
  assert.equal(sources.dayWindow(new Date(2026, 5, 11, 5, 0), 4).key, "2026-06-11");
  const w = sources.dayWindow(new Date(2026, 5, 10, 12, 0), 4);
  assert.equal(new Date(w.start).getHours(), 4);
  assert.equal(w.end - w.start, 24 * 3600 * 1000);
  assert.deepEqual(sources.windowForKey("2026-06-10", 4), w);
});

test("harness text is stripped from what the person said", () => {
  assert.equal(sources.cleanHumanText("<system-reminder>ignore</system-reminder>\n真正的问题"), "真正的问题");
  assert.equal(sources.cleanHumanText("[Request interrupted by user]"), "");
  assert.equal(sources.cleanHumanText("<local-command-stdout>Login successful</local-command-stdout>"), "");
  assert.equal(
    sources.cleanHumanText("# Files mentioned\n\n## a.png: /tmp/a.png\n\n## My request:\n丢帧是什么跟什么比？\n"),
    "丢帧是什么跟什么比？"
  );
});

test("a Claude Code transcript yields the asks, the closing reply and the files written", async () => {
  const dir = tmp();
  const file = path.join(dir, "s1.jsonl");
  jsonl(file, [
    { type: "ai-title", aiTitle: "实现 LRU 缓存", sessionId: "s1" },
    { type: "user", uuid: "u0", timestamp: new Date(2026, 5, 9, 12).toISOString(), origin: { kind: "human" }, cwd: "/w/proj", message: { role: "user", content: "昨天的问题" } },
    { type: "user", uuid: "u1", timestamp: at(10), origin: { kind: "human" }, cwd: "/w/proj", message: { role: "user", content: "帮我跑一下测试" } },
    { type: "assistant", uuid: "a1", timestamp: at(10, 1), message: { model: "m", content: [{ type: "text", text: "我先看一下。" }] } },
    { type: "assistant", uuid: "a2", timestamp: at(10, 2), message: { model: "m", content: [{ type: "tool_use", name: "Write", input: { file_path: "notes/a.md", content: "# 标题\n正文" } }] } },
    { type: "user", uuid: "t1", timestamp: at(10, 2), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] } },
    { type: "assistant", uuid: "a3", timestamp: at(10, 3), message: { model: "m", content: [{ type: "text", text: "测试全过了。" }] } },
    { type: "assistant", uuid: "a4", timestamp: at(10, 4), message: { model: "<synthetic>", content: [{ type: "text", text: "No response requested." }] } },
    { type: "user", uuid: "u2", timestamp: at(10, 5), entrypoint: "sdk-cli", message: { role: "user", content: "[clawd-analytics-internal-summary-task]\n总结一下" } },
    { type: "user", uuid: "u3", timestamp: at(10, 6), isMeta: true, origin: { kind: "human" }, message: { role: "user", content: "meta" } },
  ]);
  const s = await sources.readClaudeSession(file, win);
  assert.equal(s.title, "实现 LRU 缓存");
  assert.equal(s.cwd, "/w/proj");
  assert.deepEqual(s.turns.map((t) => [t.user, t.reply]), [["帮我跑一下测试", "测试全过了。"]]);
  assert.equal(s.touched.length, 1);
  assert.equal(s.touched[0].path, "/w/proj/notes/a.md");
  assert.equal(s.touched[0].action, "write");
});

test("a resumed session only contributes what it added", async () => {
  const dir = tmp();
  const shared = { type: "user", uuid: "same", timestamp: at(9), origin: { kind: "human" }, cwd: "/w/p", message: { role: "user", content: "第一问" } };
  jsonl(path.join(dir, "a.jsonl"), [shared]);
  jsonl(path.join(dir, "b.jsonl"), [shared, { type: "user", uuid: "new", timestamp: at(11), origin: { kind: "human" }, cwd: "/w/p", message: { role: "user", content: "第二问" } }]);
  const seen = new Set();
  const a = await sources.readClaudeSession(path.join(dir, "a.jsonl"), win, seen);
  const b = await sources.readClaudeSession(path.join(dir, "b.jsonl"), win, seen);
  assert.deepEqual(a.turns.map((t) => t.user), ["第一问"]);
  assert.deepEqual(b.turns.map((t) => t.user), ["第二问"]);
});

test("a Codex rollout yields asks, the turn's last message and file changes", async () => {
  const dir = tmp();
  const file = path.join(dir, "rollout-2026-06-10T09-00-00-00000000-0000-4000-8000-000000000002.jsonl");
  const ev = (h, m, payload) => ({ timestamp: at(h, m), type: "event_msg", payload });
  jsonl(file, [
    { timestamp: at(9), type: "session_meta", payload: { cwd: "/w/relay", thread_source: "user" } },
    ev(9, 1, { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: "<in-app-browser-context>x</in-app-browser-context>\n\n## My request:\n码率怎么算？" }] } }),
    ev(9, 2, { type: "item_completed", item: { type: "AgentMessage", content: [{ type: "text", text: "先看代码。" }] } }),
    ev(9, 3, { type: "item_completed", item: { type: "FileChange", changes: { "/vault/网络.md": { type: "update", unified_diff: "@@ -1 +1,2 @@\n 旧\n+## 滑动窗口\n+新结论" }, "/w/relay/old.md": { type: "delete" } } } }),
    ev(9, 4, { type: "task_complete", last_agent_message: "用滑动窗口。" }),
  ]);
  const s = await sources.readCodexSession(file, win);
  assert.equal(s.id, "00000000-0000-4000-8000-000000000002");
  assert.deepEqual(s.turns.map((t) => [t.user, t.reply]), [["码率怎么算？", "用滑动窗口。"]]);
  assert.deepEqual(s.touched.map((t) => [t.path, t.action, t.added]), [["/vault/网络.md", "update", "## 滑动窗口\n新结论"]]);
});

test("timers and headless runs are not counted as work", async () => {
  const heartbeat = { turns: Array.from({ length: 8 }, () => ({ user: "Read HEARTBEAT.md" })) };
  assert.equal(sources.isAutomation(heartbeat), true);
  assert.equal(sources.isAutomation({ turns: [{ user: "a" }, { user: "b" }, { user: "c" }, { user: "d" }] }), false);

  const root = tmp();
  const claudeDir = path.join(root, "claude");
  jsonl(path.join(claudeDir, "projects", "p", "auto.jsonl"), [
    { type: "user", uuid: "x1", timestamp: at(10), entrypoint: "sdk-cli", cwd: "/w/p", message: { role: "user", content: "自动总结" } },
  ]);
  jsonl(path.join(claudeDir, "projects", "p", "real.jsonl"), [
    { type: "user", uuid: "x2", timestamp: at(10), origin: { kind: "human" }, cwd: "/w/p", message: { role: "user", content: "真人提问" } },
  ]);
  const future = new Date(win.start + 3600 * 1000);
  for (const f of ["auto.jsonl", "real.jsonl"]) fs.utimesSync(path.join(claudeDir, "projects", "p", f), future, future);
  const day = await sources.collectDay({ window: win, claudeDir, codexDir: path.join(root, "codex"), home: "/home/u" });
  assert.deepEqual(day.sessions.map((s) => s.turns[0].user), ["真人提问"]);
  assert.equal(day.sessions[0].project, "w/p");
});

test("a summary written when a conversation ran out of room is not something the person asked", async () => {
  const file = path.join(tmp(), "s.jsonl");
  const retold = "This session is being continued from a previous conversation that ran out of context. The summary below covers yesterday.";
  jsonl(file, [
    { type: "ai-title", aiTitle: "生成的标题", sessionId: "s" },
    { type: "custom-title", customTitle: "给登录页换配色", sessionId: "s" },
    { type: "ai-title", aiTitle: "后来又生成的标题", sessionId: "s" },
    { type: "user", uuid: "q1", timestamp: at(10), origin: { kind: "human" }, cwd: "/w/p", message: { role: "user", content: "今天的问题" } },
    { type: "user", uuid: "q2", timestamp: at(11), isCompactSummary: true, isVisibleInTranscriptOnly: true, cwd: "/w/p", message: { role: "user", content: retold } },
    // Older transcripts carry the summary without the flag.
    { type: "user", uuid: "q3", timestamp: at(12), origin: { kind: "human" }, cwd: "/w/p", message: { role: "user", content: retold } },
  ]);
  const s = await sources.readClaudeSession(file, win);
  assert.deepEqual(s.turns.map((t) => t.user), ["今天的问题"]);
  assert.equal(s.title, "给登录页换配色"); // the name it was given beats the generated ones
});

test("answers picked in Codex's own question UI read as what the person said", () => {
  const reply = `<send_user_message_question_reply>\n${JSON.stringify([{ questionItemId: "x", question: "要不要先加缓存？", answer: "先不加" }])}\n</send_user_message_question_reply>\n`;
  assert.equal(sources.cleanHumanText(reply), "先不加（回答：要不要先加缓存？）");
  assert.equal(sources.cleanHumanText("<send_user_message_question_reply>not json</send_user_message_question_reply>"), "");
});

test("Codex conversations take their names, and worktree folders count as their repository", async () => {
  const root = tmp();
  const codexDir = path.join(root, "codex");
  const id = "00000000-0000-4000-8000-000000000001";
  const rollout = path.join(codexDir, "sessions", "2026", "06", "10", `rollout-2026-06-10T09-00-00-${id}.jsonl`);
  jsonl(rollout, [
    { timestamp: at(9), type: "session_meta", payload: { cwd: "/w/relay/worktrees", thread_source: "user" } },
    { timestamp: at(9, 1), type: "event_msg", payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: "缓存先加在哪一层？" }] } } },
  ]);
  jsonl(path.join(codexDir, "session_index.jsonl"), [
    { id, thread_name: "看一下缓存", updated_at: "x" },
    { id: "someone-else", thread_name: "别的", updated_at: "x" },
    { id, thread_name: "排查缓存命中率", updated_at: "y" },
  ]);
  const claudeDir = path.join(root, "claude");
  jsonl(path.join(claudeDir, "projects", "p", "a.jsonl"), [
    { type: "user", uuid: "w1", timestamp: at(10), origin: { kind: "human" }, cwd: "/w/relay/worktrees/feat-a", message: { role: "user", content: "分支里的问题" } },
  ]);
  jsonl(path.join(claudeDir, "projects", "p", "b.jsonl"), [
    { type: "user", uuid: "w2", timestamp: at(11), origin: { kind: "human" }, cwd: "/w/relay/.claude/worktrees/eager-cake", message: { role: "user", content: "桌面版工作副本里的问题" } },
  ]);
  const future = new Date(win.start + 8 * 3600 * 1000);
  for (const f of [rollout, path.join(claudeDir, "projects", "p", "a.jsonl"), path.join(claudeDir, "projects", "p", "b.jsonl")]) fs.utimesSync(f, future, future);

  const day = await sources.collectDay({ window: win, claudeDir, codexDir, home: "/home/u" });
  assert.deepEqual(day.sessions.map((s) => [s.agent, s.title, s.project]), [
    ["codex", "排查缓存命中率", "w/relay"],
    ["claude-code", "", "w/relay"],
    ["claude-code", "", "w/relay"],
  ]);
});

test("captured text joins the day's material, one piece per capture", () => {
  const inbox = path.join(tmp(), "inbox");
  const ts = win.start + 6 * 3600 * 1000;
  sources.appendCapture(inbox, win.key, "豆包里的一段回答", { ts, from: "豆包" });
  sources.appendCapture(inbox, win.key, "第二段\n有两行", { ts: ts + 1000 });
  assert.equal(sources.appendCapture(inbox, win.key, "   "), null);
  fs.writeFileSync(path.join(inbox, "会议纪要.md"), "# 周会\n决定先做 A");
  const later = new Date(ts + 2000);
  fs.utimesSync(path.join(inbox, "会议纪要.md"), later, later);
  fs.utimesSync(path.join(inbox, `${win.key}.md`), later, later);

  const s = sources.readInbox(inbox, win);
  assert.equal(s.project, "收件箱");
  assert.deepEqual(s.turns.map((t) => [t.note, t.from]), [
    ["豆包里的一段回答", "豆包"],
    ["第二段\n有两行", ""],
    ["# 周会\n决定先做 A", "会议纪要.md"],
  ]);
});
