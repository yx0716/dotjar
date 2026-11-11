"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const words = require("../src/overlay/words");
require("../src/overlay/demo-data");

test("both languages say everything the interface needs", () => {
  const zh = words.copy("zh", "落库");
  const en = words.copy("en");
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  assert.deepEqual(Object.keys(zh.errors).sort(), Object.keys(en.errors).sort());
  // The four a pass turns up, then the four places an agent writes to.
  assert.deepEqual(Object.keys(zh.kinds), ["craft", "strategy", "lesson", "trap", "note", "rule", "skill", "memory"]);
  assert.deepEqual(Object.keys(en.kinds), Object.keys(zh.kinds));
  assert.deepEqual(Object.keys(zh.kindHints), ["craft", "strategy", "lesson", "trap"]);
  assert.deepEqual(Object.keys(zh.recapCols), ["running", "waiting", "done"]);
  assert.deepEqual(Object.keys(en.recapCols), Object.keys(zh.recapCols));
  assert.equal(zh.restLines.length, en.restLines.length);
  for (const [key, value] of Object.entries(en)) {
    const sample = typeof value === "function" ? "" : JSON.stringify(value);
    assert.ok(!/[一-鿿]/.test(sample), `English "${key}" still has Chinese in it`);
  }
});

test("every Chinese wording is a complete set", () => {
  const keys = Object.keys(words.pick("落库")).sort();
  for (const name of words.names) assert.deepEqual(Object.keys(words.pick(name)).sort(), keys, name);
  assert.equal(words.copy("zh", "攒").keep, "攒下");
  assert.equal(words.copy("zh", "落库").keep, "落库");
  // Left alone, or set to one that is not there, it is the one about stars.
  assert.equal(words.DEFAULT, "打捞");
  assert.equal(words.copy("zh").keep, "收下");
  assert.equal(words.copy("zh", "没有这套").library, "星罐");
  assert.equal(words.copy("en", "攒").keep, "Keep", "English has one wording");
});

test("language is read from a setting or a locale, and sentences come out whole", () => {
  assert.equal(words.language("zh-Hans-CN"), "zh");
  assert.equal(words.language("en-US"), "en");
  assert.equal(words.language("auto"), "");
  assert.equal(words.copy("fr").lang, "zh");

  const zh = words.copy("zh", "落库");
  const en = words.copy("en");
  assert.equal(zh.date("2026-10-13"), "10月13日 周二");
  assert.equal(en.date("2026-10-13"), "Tue, Oct 13");
  assert.equal(zh.statusDone("17:42", 3, 9, zh.agents([{ name: "Codex", sessions: 6 }]), 2), "17:42 打捞过：3 个项目，9 段对话（Codex 6），之后又问了 2 次。");
  assert.equal(en.statusDone("17:42", 1, 9, en.agents([{ name: "Codex", sessions: 6 }]), 1), "Went through at 17:42: 1 project, 9 conversations (Codex 6), 1 ask since.");
  assert.equal(en.overviewTitle(1), "1 thing today");
  assert.equal(zh.overviewTitle(5, 8), "今日银河里，为你打捞起 8 颗星");
  assert.equal(en.overviewTitle(5, 1), "5 things today, 1 star caught");
  assert.equal(zh.seeOpen(4), "看 4 条待落库");
  assert.equal(words.copy("zh").seeOpen(4), "看看捞到的 4 颗");
  assert.equal(en.seeOpen(4), "See the 4 you caught");
  // The rest, and the look back at the stretch before it.
  assert.equal(zh.restIn(32), "32 分钟后");
  assert.equal(zh.recapSum(12, 4), "你问了 12 次，推进了 4 件事");
  assert.equal(en.recapSum(1, 1), "You asked 1 time and moved 1 thing along");
  assert.equal(en.jarTotal(1), "1 star in the jar");
});

test("the demo day exists in both languages, item for item", () => {
  const { zh, en } = globalThis.DotjarDemo.DATA;
  for (const part of ["candidates", "settled", "tasks", "keptEarlier"]) {
    assert.equal(zh[part].length, en[part].length, part);
    assert.deepEqual(zh[part].map((x) => x.kind || x.share), en[part].map((x) => x.kind || x.share), part);
  }
  assert.ok(!/[一-鿿]/.test(JSON.stringify(en)));
  // The made-up day shows one of each kind a pass turns up.
  assert.deepEqual(zh.candidates.map((c) => c.kind), ["craft", "lesson", "strategy", "trap"]);
  // And a look back with something in each column of the board.
  for (const lang of [zh, en]) {
    assert.deepEqual([...new Set(lang.recap.things.map((t) => t.state))].sort(), ["done", "running", "waiting"]);
    assert.equal(lang.growth.applied.length, 1);
  }
  assert.deepEqual(zh.recap.things.map((t) => t.state), en.recap.things.map((t) => t.state));
});

test("when the day on screen is yesterday, the text says yesterday", () => {
  const zh = words.copy("zh", "落库", 1);
  const en = words.copy("en", "", 1);
  assert.equal(zh.tabToday, "昨天");
  assert.equal(zh.overviewTitle(5), "昨天做了 5 件事");
  assert.equal(zh.distill, "打捞昨天");
  assert.equal(zh.title, "昨日落库");
  assert.equal(words.copy("zh", "", 1).title, "昨日打捞");
  assert.equal(zh.doneToday(3), "昨天已经落库 3 条");
  assert.equal(en.tabToday, "Yesterday");
  assert.equal(en.overviewTitle(5), "5 things yesterday");
  assert.equal(en.title, "Yesterday's catch");
  // What is said about adding material still means the real today.
  assert.equal(zh.captured, "已加入今天");
  assert.equal(en.pasteBtn, "Add clipboard to today");
  assert.equal(words.copy("zh", "落库", 0).tabToday, "今天");
});

test("an earlier day is named by its date, in sentences that still read right", () => {
  const zh = words.copy("zh", "落库", 2, "2026-10-12");
  const en = words.copy("en", "", 2, "2026-10-12");
  assert.equal(zh.tabToday, "10月12日");
  assert.equal(zh.overviewTitle(5), "10月12日做了 5 件事");
  assert.equal(zh.distill, "打捞 10月12日");
  assert.equal(zh.distillingText("本地的 Codex"), "本地的 Codex 正在读 10月12日的记录，大概要半分钟到一分钟。");
  assert.equal(zh.overviewRough(6), "10月12日开了 6 段对话");
  assert.equal(en.tabToday, "Oct 12");
  assert.equal(en.overviewTitle(5), "5 things on Oct 12");
  assert.equal(en.distill, "Go through Oct 12");
  assert.equal(en.decidedTitle, "All decided for Oct 12");
  assert.equal(en.title, "Oct 12's catch");
  assert.ok(en.notYetText("your local Claude").includes("reads Oct 12's conversations"));

  const plain = words.copy("zh", "落库");
  assert.equal(plain.dayOption("10月13日 周二", [plain.dayThings(5), plain.dayOpen(3)]), "10月13日 周二：5 件事，3 条没定");
  assert.equal(words.copy("en").dayOption("Tue, Oct 13", []), "Tue, Oct 13");
  assert.equal(words.copy("zh").engineFull("codex-cli"), "本地的 Codex");
  assert.equal(words.copy("en").engineBtn(words.copy("en").engineShort("openai", "doubao-pro")), "Using doubao-pro");
});
