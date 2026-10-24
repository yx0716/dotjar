"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// The ledger resolves its folder at call time, so each test gets its own.
function freshHome() {
  process.env.DOTJAR_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-ledger-"));
  return process.env.DOTJAR_HOME;
}

const ledger = require("../src/core/ledger");
const { itemId } = require("../src/core/distill");
const markdown = require("../src/overlay/markdown");

const item = (kind, title) => ({ id: itemId(kind, title), kind, title, payoff: "用上的时候", projects: ["a/b"], draft: "**核心结论**：正文" });

test("going through a day again only adds; nothing already listed is dropped or undone", () => {
  const home = freshHome();
  const a = item("note", "甲");
  const b = item("rule", "乙");
  const c = item("skill", "丙");
  ledger.saveDay(ledger.applyDistilled(ledger.loadDay("2026-06-10"), [a, b, c], { at: 1, model: "m" }));
  ledger.keep("2026-06-10", a.id, path.join(home, "deposits"));
  ledger.skip("2026-06-10", b.id);

  const again = ledger.applyDistilled(ledger.loadDay("2026-06-10"), [a, b, item("note", "丁")], { at: 2, model: "m" });
  const status = Object.fromEntries(again.items.map((i) => [i.title, i.status]));
  assert.deepEqual(status, { 甲: "kept", 乙: "skipped", 丙: "open", 丁: "open" });
  assert.deepEqual(again.items.map((i) => i.title), ["甲", "乙", "丙", "丁"], "what is new comes after what was there");
  assert.equal(again.items.find((i) => i.title === "丁").foundAt, 2);
  assert.equal(again.distilledAt, 2);
});

test("keeping writes a note the knowledge base can take as is", () => {
  const home = freshHome();
  const dir = path.join(home, "deposits");
  const a = item("note", 'a/b: 键由"调用方"生成?');
  ledger.saveDay(ledger.applyDistilled(ledger.loadDay("2026-06-10"), [a, item("note", "另一条")]));

  const { item: kept } = ledger.keep("2026-06-10", a.id, dir);
  assert.equal(path.basename(kept.file), "a b 键由 调用方 生成.md");
  const text = fs.readFileSync(kept.file, "utf8");
  assert.ok(text.startsWith("---\ncreated: 2026-06-10\nsource: dotjar\nkind: note\nprojects: [\"a/b\"]\ntags: [dotjar/心得]\n---\n"));
  assert.ok(text.includes('# a/b: 键由"调用方"生成?'));
  assert.ok(text.includes("**什么时候用上**：用上的时候"));

  // In English the note's own two labels are English too.
  const english = ledger.renderDeposit({ ...a, payoff: "designing a write endpoint" }, "2026-06-10", "en");
  assert.ok(english.includes("tags: [dotjar/lesson]"));
  assert.ok(english.includes("**Useful when**: designing a write endpoint"));

  // Keeping the same item twice does not write a second file.
  assert.equal(ledger.keep("2026-06-10", a.id, dir).item.file, kept.file);
  assert.equal(fs.readdirSync(dir).length, 1);

  // An existing note with the same name is never overwritten.
  const other = item("rule", "同名");
  fs.writeFileSync(path.join(dir, "同名.md"), "已有内容");
  ledger.saveDay(ledger.applyDistilled(ledger.loadDay("2026-06-11"), [other]));
  assert.equal(path.basename(ledger.keep("2026-06-11", other.id, dir).item.file), "同名 2.md");
  assert.equal(fs.readFileSync(path.join(dir, "同名.md"), "utf8"), "已有内容");
});

test("reopening hands back the file instead of deleting it", () => {
  const home = freshHome();
  const a = item("note", "甲");
  ledger.saveDay(ledger.applyDistilled(ledger.loadDay("2026-06-10"), [a]));
  const { item: kept } = ledger.keep("2026-06-10", a.id, path.join(home, "deposits"));
  const res = ledger.reopen("2026-06-10", a.id);
  assert.equal(res.file, kept.file);
  assert.ok(fs.existsSync(kept.file));
  assert.equal(res.item.status, "open");
  assert.throws(() => ledger.skip("2026-06-10", "missing"), /不在今天的列表里/);
});

test("history is one bed per day that settled anything, oldest first", () => {
  const home = freshHome();
  const a = item("note", "甲");
  let day1 = ledger.applyDistilled(ledger.loadDay("2026-06-08"), [a, item("rule", "乙")]);
  day1 = ledger.snapshotSettled(day1, [{ kind: "memory", name: "偏好", gists: ["提交说明写原因", "x"], where: "repo", path: "/m.md", isNew: true, ts: 1 }]);
  ledger.saveDay(day1);
  ledger.keep("2026-06-08", a.id, path.join(home, "deposits"));
  ledger.skip("2026-06-08", itemId("rule", "乙"));
  ledger.saveDay(ledger.applyDistilled(ledger.loadDay("2026-06-09"), [item("note", "只是候选")]));
  ledger.saveDay(ledger.snapshotSettled(ledger.loadDay("2026-06-10"), [{ kind: "note", name: "网络", gists: [], where: "Area", path: "/n.md", ts: 2 }]));

  assert.deepEqual(ledger.history(30, "2026-06-10"), [
    { day: "2026-06-08", layers: [{ kind: "memory", title: "提交说明写原因", by: "agent" }, { kind: "note", title: "甲", by: "you" }] },
    { day: "2026-06-10", layers: [{ kind: "note", title: "网络", by: "agent" }] },
  ]);
  assert.deepEqual(ledger.history(30, "2026-06-09").map((b) => b.day), ["2026-06-08"]);
  assert.deepEqual(ledger.recentTitles(14, "2026-06-10"), { kept: ["甲"], skipped: ["乙"] });
  assert.equal(ledger.loadDay("2026-06-08").settled[0].more, 1);
});

test("drafts are rendered without letting their text become markup", () => {
  const html = markdown.render('**核心结论**：用 `Idempotency-Key`\n\n1. 第一步\n2. 第二步 <img src=x onerror=alert(1)>\n\n- 甲\n\n```\n<b>raw</b>\n```\n[[笔记|别名]] 和 [链接](http://x)');
  assert.ok(html.includes("<strong>核心结论</strong>"));
  assert.ok(html.includes("<code>Idempotency-Key</code>"));
  assert.ok(html.includes("<ol><li>第一步</li><li>第二步 &lt;img src=x onerror=alert(1)&gt;</li></ol>"));
  assert.ok(html.includes("<ul><li>甲</li></ul>"));
  assert.ok(html.includes("<pre><code>&lt;b&gt;raw&lt;/b&gt;</code></pre>"));
  assert.ok(html.includes('<span class="wikilink">别名</span> 和 链接'));
  assert.ok(!/<img|<b>/.test(html));
});

test("the day's tasks are kept with the day, and survive a reply that has none", () => {
  freshHome();
  const tasks = [{ title: "重复扣款排查", effort: 5, human: "判断键由谁生成", ai: "写压测", share: "high" }];
  let day = ledger.applyDistilled(ledger.loadDay("2026-06-10"), [], { at: 1, tasks });
  ledger.saveDay(day);
  assert.deepEqual(ledger.loadDay("2026-06-10").tasks, tasks);
  day = ledger.applyDistilled(ledger.loadDay("2026-06-10"), [], { at: 2, tasks: [] });
  assert.deepEqual(day.tasks, tasks);
  assert.deepEqual(ledger.loadDay("2026-06-09").tasks, []);
});

test("what is left undecided carries over to the following days", () => {
  const home = freshHome();
  const dotjar = require("../src/core/dotjar");
  const config = require("../src/core/config");
  const { dayWindow } = require("../src/core/sources");
  const cfg = config.load();
  const win = dayWindow(new Date(), cfg.dayStartHour);
  const yesterday = ledger.keyDaysBefore(win.key, 1);
  const lastWeek = ledger.keyDaysBefore(win.key, 6);
  const tooOld = ledger.keyDaysBefore(win.key, 120);

  const old = item("note", "上周没定的");
  const stale = item("note", "太久以前的");
  const a = item("note", "昨天没定的");
  const b = item("rule", "昨天已经略过的");
  const mine = item("skill", "今天新挑出的");
  ledger.saveDay(ledger.applyDistilled(ledger.loadDay(tooOld), [stale]));
  ledger.saveDay(ledger.applyDistilled(ledger.loadDay(lastWeek), [old]));
  ledger.saveDay(ledger.applyDistilled(ledger.loadDay(yesterday), [a, b]));
  ledger.skip(yesterday, b.id);
  // That skip was made yesterday, not just now.
  const then = ledger.loadDay(yesterday);
  then.items.find((i) => i.id === b.id).skippedAt = win.start - 3600 * 1000;
  ledger.saveDay(then);
  // The same thing offered again today is not shown twice.
  ledger.saveDay(ledger.applyDistilled(ledger.loadDay(win.key), [mine, a]));

  assert.deepEqual(ledger.backlog(win.key).map((i) => [i.title, i.day]), [["上周没定的", lastWeek], ["昨天没定的", yesterday]]);

  const scanned = () => ({ window: win, sessions: [], day: ledger.loadDay(win.key), daysBack: 0 });
  let v = dotjar.view(cfg, scanned());
  assert.deepEqual(v.candidates.map((c) => [c.title, c.day]), [["上周没定的", lastWeek], ["昨天没定的", yesterday], ["今天新挑出的", win.key]]);
  assert.equal(v.todayKey, win.key);

  // Deciding on a carried-over card is recorded where the card came from,
  // and counts as something kept today.
  assert.equal(ledger.dayOf(a.id, win.key), win.key, "a duplicate offered today is found there first");
  assert.equal(ledger.dayOf(old.id, win.key), lastWeek);
  ledger.keep(ledger.dayOf(old.id, win.key), old.id, path.join(home, "deposits"));
  v = dotjar.view(cfg, scanned());
  assert.deepEqual(v.candidates.map((c) => c.title), ["昨天没定的", "今天新挑出的"]);
  assert.deepEqual(v.kept.map((k) => [k.title, k.day]), [["上周没定的", lastWeek]]);
  assert.equal(ledger.loadDay(lastWeek).items[0].status, "kept");
  assert.equal(v.skipped, 0, "what was skipped on an earlier day is not today's doing");
  assert.throws(() => ledger.dayOf(stale.id, win.key), /不在列表里/);
});

test("several days can be gone through in one go, one after another", async () => {
  freshHome();
  const dotjar = require("../src/core/dotjar");
  const real = { distillToday: dotjar.distillToday, scan: dotjar.scan, view: dotjar.view };
  const asked = [];
  dotjar.distillToday = async (_cfg, options) => {
    asked.push(options.day);
    if (options.day === "2026-06-02") {
      const err = new Error("今天还没有和 agent 一起工作的记录");
      err.code = "NO_WORK";
      throw err;
    }
    return { found: 2 };
  };
  dotjar.scan = async () => ({ window: { key: "2026-06-11" }, sessions: [], day: ledger.loadDay("2026-06-11"), daysBack: 0 });
  dotjar.view = () => ({ day: "2026-06-11" });
  try {
    const { createSession } = require("../src/core/session");
    const session = createSession({ language: "zh" });
    const running = session.distill(["2026-06-03", "2026-06-01", "2026-06-02", "2026-06-03", "nonsense"]);
    assert.deepEqual(session.isDistilling(), { done: 0, total: 3, day: "2026-06-01" });
    const res = await running;
    assert.deepEqual(asked, ["2026-06-01", "2026-06-02", "2026-06-03"], "oldest first, each once");
    assert.deepEqual([res.days, res.found, res.failed.map((f) => [f.day, f.code])], [3, 4, [["2026-06-02", "NO_WORK"]]]);
    assert.equal(session.isDistilling(), false);
  } finally {
    Object.assign(dotjar, real);
  }
});
