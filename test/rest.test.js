"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DOTJAR_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-rest-"));

const rest = require("../src/core/rest");

const MIN = 60 * 1000;
const at = (h, m) => new Date(2026, 2, 18, h, m).getTime();
const session = (over) => ({ agent: "claude-code", project: "work/gateway", title: "", turns: [], ...over });

test("a stretch of time is told as what moved, and where each thing stands", () => {
  const sessions = [
    session({
      title: "排查重复扣款",
      turns: [
        // Out of order on purpose: transcripts are not always read in time order.
        { ts: at(10, 30), user: "加幂等键", reply: "" },
        { ts: at(10, 5), user: "看下为什么扣了两次", reply: "## 结论\n网关 3 秒超时后重发了请求。", endTs: at(10, 20) },
        { ts: at(9, 40), user: "更早的一问，不在这一段里", reply: "好", endTs: at(9, 45) },
      ],
    }),
    session({ agent: "codex", project: "work/console", turns: [{ ts: at(10, 10), user: "把缓存改成只挡带筛选的查询", reply: "改好了，测试通过。\n\n要不要顺手把旧的缓存层删掉？", endTs: at(10, 25) }] }),
    session({ project: "work/console", title: "发布说明", turns: [{ ts: at(10, 40), user: "生成这周的发布说明", reply: "**初稿** 已写入 docs/release.md。", endTs: at(10, 44) }] }),
    // Material pasted in by hand is not a question asked of an agent.
    session({ agent: "inbox", project: "inbox", turns: [{ ts: at(10, 15), user: "", reply: "", note: "一段会议纪要" }] }),
  ];
  const recap = rest.blockRecap(sessions, at(10, 0), at(10, 50));

  assert.deepEqual([recap.from, recap.to, recap.minutes, recap.asks], ["10:00", "10:50", 50, 4]);
  // Newest activity first; each says what set it going, the latest ask, and how the agent left it.
  assert.deepEqual(recap.things.map((t) => [t.title, t.project, t.agent, t.asks, t.state]), [
    ["发布说明", "console", "Claude Code", 1, "done"],
    ["排查重复扣款", "gateway", "Claude Code", 2, "running"],
    ["console", "", "Codex", 1, "waiting"],
  ]);
  const charge = recap.things[1];
  assert.deepEqual([charge.ask, charge.latest, charge.reply, charge.from, charge.to], ["看下为什么扣了两次", "加幂等键", "", "10:05", "10:30"]);
  assert.deepEqual(charge.marks, [0.1, 0.6], "where in the stretch each ask fell");
  assert.equal(recap.things[0].reply, "初稿 已写入 docs/release.md。", "the closing line without its markup");
  assert.equal(recap.things[2].reply, "改好了，测试通过。");
  assert.deepEqual([recap.running, recap.waiting, recap.done, recap.more], [1, 1, 1, 0]);

  // Something said along the way is not the agent being done: where the
  // transcript says the turn is still open, it is still running. Unless it
  // has shown no sign of life for a long while, in which case it was stopped
  // and the thing waits on the person.
  const midway = (activeTs) => [session({ title: "跑迁移", turns: [{ ts: at(10, 5), user: "跑一下迁移", reply: "先看一眼表结构。", endTs: at(10, 6), open: true, activeTs }] })];
  assert.equal(rest.blockRecap(midway(at(10, 48)), at(10, 0), at(10, 50)).things[0].state, "running");
  assert.equal(rest.blockRecap(midway(at(10, 20)), at(10, 0), at(10, 50)).things[0].state, "waiting");

  // A long job asked for before the stretch began and still going through it
  // belongs in the look back, with nothing asked of it in this stretch.
  const carried = [session({ title: "全量回归", turns: [{ ts: at(10, 12), user: "", reply: "", open: true, activeTs: at(10, 47) }] })];
  const long = rest.blockRecap(carried, at(10, 0), at(10, 50));
  assert.deepEqual(long.things.map((t) => [t.title, t.asks, t.ask, t.state, t.to, t.marks.length]), [["全量回归", 0, "", "running", "10:47", 0]]);
  assert.equal(long.asks, 0);

  // Nothing asked in the stretch: nothing to tell.
  assert.deepEqual(rest.blockRecap(sessions, at(12, 0), at(12, 50)).things, []);
});

test("a closing message that ends on a question hands the turn back", () => {
  assert.equal(rest.asksBack("改好了。\n\n要不要我也把测试补上？"), true);
  assert.equal(rest.asksBack("Done. Want me to open a PR?"), true);
  assert.equal(rest.asksBack("为什么慢？因为没走索引。\n\n已经加上了索引，耗时从 3 秒降到 40 毫秒。"), false);
  assert.equal(rest.gist("\n\n> **结论**：`a` 比 b 快\n别的"), "结论：a 比 b 快");
});

// A rest timer over a made-up clock and made-up work. What it remembers
// across restarts goes in a folder of its own each time.
function timer(over = {}) {
  process.env.DOTJAR_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-rest-"));
  let cfg = { rest: { enabled: true, everyMin: 50, forMin: 5 }, ...over.cfg };
  const world = { now: at(9, 0), idle: 0, asks: [], due: 0 };
  const r = rest.createRest({
    getConfig: () => cfg,
    saveConfig: (patch) => (cfg = { ...cfg, ...patch }),
    now: () => world.now,
    idle: () => world.idle,
    onDue: () => world.due++,
    collect: async (from, to) => [session({ title: "一件事", turns: world.asks.filter((ts) => ts >= from && ts < to).map((ts) => ({ ts, user: "问", reply: "好", endTs: ts + MIN })) })],
  });
  return { r, world, cfg: () => cfg };
}

test("a rest falls due after a stretch of work, not a stretch of the clock", async () => {
  const { r, world } = timer();
  // Fifty minutes on, but nothing was asked of an agent: no rest, and the stretch starts over.
  world.now = at(9, 50);
  assert.equal((await r.tick()).phase, "idle");
  assert.equal(world.due, 0);

  // Work began at 10:00. Fifty minutes of the clock later is only forty of work.
  world.asks = [at(10, 0), at(10, 20), at(10, 45)];
  world.now = at(10, 40);
  assert.equal((await r.tick()).phase, "idle");
  world.now = at(10, 49);
  assert.equal((await r.tick()).phase, "idle");
  assert.equal(r.status().dueAt, at(10, 50), "counted from the first ask");

  world.now = at(10, 50);
  const s = await r.tick();
  assert.deepEqual([s.phase, s.startedAt, s.endsAt, world.due], ["resting", at(10, 50), at(10, 55), 1]);

  // The look back covers the stretch that led up to it.
  world.now = at(10, 54);
  const recap = await r.recap();
  assert.deepEqual([recap.from, recap.to, recap.minutes, recap.asks], ["10:00", "10:50", 50, 3]);

  // Back to it: the next stretch is counted from here.
  world.now = at(10, 56);
  const after = r.done();
  assert.deepEqual([after.phase, after.count, after.dueAt], ["idle", 1, at(11, 46)]);
  assert.equal(await r.recap(), null);
});

test("away from the keyboard is a rest already; skipping and putting off do what they say", async () => {
  const { r, world } = timer();
  world.asks = [at(9, 5), at(9, 30), at(10, 0), at(10, 20), at(10, 40)];

  // Gone for as long as a rest lasts: that was one. No asking on the way back
  // in, and the fifty minutes are counted from the work done after it.
  world.now = at(9, 55);
  world.idle = 6 * 60;
  assert.equal((await r.tick()).phase, "idle");
  assert.equal(world.due, 0);
  world.idle = 0;
  world.now = at(10, 46);
  assert.equal((await r.tick()).phase, "idle");
  assert.equal(r.status().dueAt, at(10, 50));

  // Due, but stepped away a couple of minutes ago: it waits for them to be there.
  world.now = at(10, 52);
  world.idle = 150;
  assert.equal((await r.tick()).phase, "idle");
  world.idle = 0;
  assert.equal((await r.tick()).phase, "resting");

  // Put off: asked again in five minutes, about the same stretch.
  assert.equal(r.snooze().phase, "idle");
  world.now = at(10, 55);
  assert.equal((await r.tick()).phase, "idle");
  world.now = at(10, 58);
  assert.equal((await r.tick()).phase, "resting");
  assert.equal((await r.recap()).from, "10:00");

  // Skipped: not counted as one taken, and the next stretch starts here.
  const skipped = r.skip();
  assert.deepEqual([skipped.phase, skipped.count, skipped.dueAt], ["idle", 0, at(11, 48)]);

  // A rest nobody came back from is closed by itself.
  world.asks.push(at(10, 59));
  world.now = at(11, 50);
  assert.equal((await r.tick()).phase, "resting");
  world.now = at(12, 30);
  const closed = await r.tick();
  assert.deepEqual([closed.phase, closed.count], ["idle", 1]);
});

test("it is off until switched on, and can be asked for by hand either way", async () => {
  const { r, world, cfg } = timer({ cfg: { rest: { enabled: false } } });
  world.asks = [at(9, 10), at(9, 40)];
  world.now = at(10, 30);
  const off = await r.tick();
  assert.deepEqual([off.enabled, off.phase, off.dueAt, off.everyMin, off.forMin], [false, "idle", 0, 50, 5]);

  // Asked for by hand: one stretch's worth to look back on.
  const s = r.start();
  assert.deepEqual([s.phase, s.endsAt - s.startedAt], ["resting", 5 * MIN]);
  assert.deepEqual([(await r.recap()).from, (await r.recap()).asks], ["09:40", 1]);
  r.done();

  // Switched on: counted from that moment, with the settings kept.
  world.now = at(11, 0);
  const on = r.set({ enabled: true, everyMin: 25, forMin: 3 });
  assert.deepEqual([on.enabled, on.everyMin, on.forMin, on.dueAt], [true, 25, 3, at(11, 25)]);
  assert.deepEqual(cfg().rest, { enabled: true, everyMin: 25, forMin: 3 });
  // Nonsense is not kept.
  assert.deepEqual(rest.settings({ rest: { enabled: "yes", everyMin: -4, forMin: "soon" } }), { enabled: true, everyMin: 50, forMin: 5 });
});
