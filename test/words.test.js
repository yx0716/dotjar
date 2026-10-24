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
  assert.deepEqual(Object.keys(zh.kinds), ["note", "rule", "skill", "memory"]);
  for (const [key, value] of Object.entries(en)) {
    const sample = typeof value === "function" ? "" : JSON.stringify(value);
    assert.ok(!/[一-鿿]/.test(sample), `English "${key}" still has Chinese in it`);
  }
});

test("every Chinese wording is a complete set", () => {
  const keys = Object.keys(words.pick("落库")).sort();
  for (const name of words.names) assert.deepEqual(Object.keys(words.pick(name)).sort(), keys, name);
  assert.equal(words.copy("zh", "攒").keep, "攒下");
  assert.equal(words.copy("zh", "没有这套").keep, "落库");
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
  assert.equal(zh.statusDone("17:42", 3, 9, zh.agents([{ name: "Codex", sessions: 6 }]), 2), "17:42 整理过：3 个项目，9 段对话（Codex 6），之后又问了 2 次。");
  assert.equal(en.statusDone("17:42", 1, 9, en.agents([{ name: "Codex", sessions: 6 }]), 1), "Went through at 17:42: 1 project, 9 conversations (Codex 6), 1 ask since.");
  assert.equal(en.overviewTitle(1), "1 thing today");
  assert.equal(zh.see(4, zh), "看 4 条待落库");
  assert.equal(en.see(4, en), "See 4 worth keeping");
});

test("the demo day exists in both languages, item for item", () => {
  const { zh, en } = globalThis.DotjarDemo.DATA;
  for (const part of ["candidates", "settled", "tasks"]) {
    assert.equal(zh[part].length, en[part].length, part);
    assert.deepEqual(zh[part].map((x) => x.kind || x.share), en[part].map((x) => x.kind || x.share), part);
  }
  assert.ok(!/[一-鿿]/.test(JSON.stringify(en)));
});

test("when the day on screen is yesterday, the text says yesterday", () => {
  const zh = words.copy("zh", "落库", 1);
  const en = words.copy("en", "", 1);
  assert.equal(zh.tabToday, "昨天");
  assert.equal(zh.overviewTitle(5), "昨天做了 5 件事");
  assert.equal(zh.distill, "整理昨天");
  assert.equal(zh.title, "昨日落库");
  assert.equal(zh.doneToday(3), "昨天已经落库 3 条");
  assert.equal(en.tabToday, "Yesterday");
  assert.equal(en.overviewTitle(5), "5 things yesterday");
  assert.equal(en.title, "Yesterday's keepers");
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
  assert.equal(zh.distill, "整理 10月12日");
  assert.equal(zh.distillingText("本地的 Codex"), "本地的 Codex 正在读 10月12日的记录，大概要半分钟到一分钟。");
  assert.equal(zh.overviewRough(6), "10月12日开了 6 段对话");
  assert.equal(en.tabToday, "Oct 12");
  assert.equal(en.overviewTitle(5), "5 things on Oct 12");
  assert.equal(en.distill, "Go through Oct 12");
  assert.equal(en.decidedTitle, "All decided for Oct 12");
  assert.equal(en.title, "Oct 12's keepers");
  assert.ok(en.notYetText("your local Claude").includes("reads Oct 12's conversations"));

  const plain = words.copy("zh", "落库");
  assert.equal(plain.dayOption("10月13日 周二", [plain.dayThings(5), plain.dayOpen(3)]), "10月13日 周二：5 件事，3 条没定");
  assert.equal(words.copy("en").dayOption("Tue, Oct 13", []), "Tue, Oct 13");
  assert.equal(words.copy("zh").engineFull("codex-cli"), "本地的 Codex");
  assert.equal(words.copy("en").engineBtn(words.copy("en").engineShort("openai", "doubao-pro")), "Using doubao-pro");
});
