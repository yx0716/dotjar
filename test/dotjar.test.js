"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DOTJAR_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-view-"));

const config = require("../src/core/config");
const dotjar = require("../src/core/dotjar");

const at = (h, m) => new Date(2026, 2, 18, h, m).getTime();
const session = (project, turns) => ({ agent: "claude-code", id: project, cwd: `/r/${project}`, project, title: "", touched: [], turns });

test("before a day is gone through, each project sits at the hours it was worked on", () => {
  const sessions = [
    // Out of order on purpose: the first ask is not always the first turn kept.
    session("a/ledger", [
      { ts: at(10, 40), user: "第二问", reply: "好", endTs: at(11, 5) },
      { ts: at(10, 10), user: "第一问", reply: "好", endTs: at(10, 20) },
    ]),
    session("a/gateway", [{ ts: at(9, 15), user: "问", reply: "好", endTs: at(9, 50) }]),
  ];
  const win = { key: "2026-03-18", start: at(4, 0), end: at(4, 0) + 24 * 3600 * 1000 };
  const v = dotjar.view(config.load(), { window: win, sessions, day: { items: [], tasks: [], settled: [] }, todayKey: win.key });

  assert.equal(v.tasksAreRough, true);
  assert.deepEqual(v.tasks.map((t) => [t.title, t.asks, t.from, t.to]), [
    ["ledger", 2, "10:10", "11:05"],
    ["gateway", 1, "09:15", "09:50"],
  ]);
  // Asks per half hour, from the half hour of the first to the end of the last.
  assert.deepEqual(v.activity, { from: "09:00", to: "11:00", bins: [1, 0, 1, 1] });
});

test("a day with no asks has no activity to draw", () => {
  const win = { key: "2026-03-18", start: at(4, 0), end: at(4, 0) + 24 * 3600 * 1000 };
  const v = dotjar.view(config.load(), { window: win, sessions: [], day: { items: [], tasks: [], settled: [] }, todayKey: win.key });
  assert.equal(v.activity, null);
  assert.deepEqual(v.tasks, []);
});

test("before a day is gone through, a named conversation is its own thing", () => {
  const named = (title, project, h) => ({ ...session(project, [{ ts: at(h, 0), user: "问", reply: "好", endTs: at(h, 20) }]), title });
  const sessions = [
    named("排查缓存命中率", "work/relay", 9),
    named("排查缓存命中率", "work/relay", 11), // resumed under the same name
    named("写这周的周报", "repos/home", 10),
    named("", "work/relay", 13),
    named("", "work/relay", 14),
  ];
  const win = { key: "2026-03-18", start: at(4, 0), end: at(4, 0) + 24 * 3600 * 1000 };
  const v = dotjar.view(config.load(), { window: win, sessions, day: { items: [], tasks: [], settled: [] }, todayKey: win.key });
  assert.deepEqual(v.tasks.map((t) => [t.title, t.project, t.asks, t.from, t.to]), [
    ["排查缓存命中率", "relay", 2, "09:00", "11:20"],
    ["relay", "", 2, "13:00", "14:20"],
    ["写这周的周报", "home", 1, "10:00", "10:20"],
  ]);
});

test("each of a day's dots sits by the task it came from, or at the end when none fits", () => {
  const tasks = [
    { title: "重复扣款排查", human: "定幂等键该由谁生成", ai: "复现超时重试、写压测", share: "high" },
    { title: "账本迁移", human: "先加可空列再收紧约束", ai: "写迁移脚本和回滚语句", share: "mid" },
  ];
  const items = [
    { id: "a", kind: "note", title: "键要调用方生成", task: "重复扣款排查", status: "kept", file: "/n/a.md" },
    { id: "b", kind: "rule", title: "改结构前先给出回滚语句", payoff: "写迁移脚本时", draft: "", status: "open" },
    { id: "c", kind: "note", title: "周末的天气", payoff: "", draft: "晴", status: "skipped" },
  ];
  const day = { items, tasks, settled: [], distilledAt: 1 };
  const win = { key: "2026-03-18", start: at(4, 0), end: at(4, 0) + 24 * 3600 * 1000 };
  const v = dotjar.view(config.load(), { window: win, sessions: [], day, todayKey: win.key });
  assert.deepEqual(v.dots.map((d) => [d.id, d.task, d.status]), [["a", 0, "kept"], ["b", 1, "open"], ["c", -1, "skipped"]]);
  assert.equal(v.dots[0].file, "/n/a.md");
  // Before the day is gone through there is nothing to place.
  const rough = dotjar.view(config.load(), { window: win, sessions: [], day: { items: [], tasks: [], settled: [] }, todayKey: win.key });
  assert.deepEqual(rough.dots, []);
});
