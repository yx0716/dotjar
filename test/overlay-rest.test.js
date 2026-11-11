"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Run the actual reminder controller with a fake clock and host, without
// touching the desktop or waiting through a real break.
function fixture(read) {
  const source = fs.readFileSync(path.join(__dirname, "../src/overlay/overlay.js"), "utf8");
  const clock = { now: 100000 };
  const context = vm.createContext({
    Date: { now: () => clock.now }, URLSearchParams,
    params: new URLSearchParams(), nativeRest: null, inBrowser: false,
    document: { hidden: false }, api: { restRecap: read },
    T: { restLines: ["rest"] },
    el: { rest: { hidden: true, querySelector: () => null } },
    closeCal() {}, closeRestPop() {}, renderRestButton() {}, renderRestPop() {}, tellRestWindow() {},
    setInterval() { return 1; }, clearInterval() {},
  });
  const controller = source.slice(source.indexOf("  const rest = {"), source.indexOf("  // What the stretch held, as a board:"));
  vm.runInContext(controller + `
    function renderRest() { rest.over = restLeft() <= 0; }
    globalThis.harness = { rest, applyRest, tickRest, loadRecap };
  `, context);
  const status = (start = 90000, end = 102000) => ({ phase: "resting", startedAt: start, endsAt: end, now: clock.now, count: 0 });
  return { ...context.harness, clock, status, flush: () => new Promise(setImmediate) };
}

test("failed recap retries after the countdown and stays visible until dismissal", async () => {
  let calls = 0;
  const board = { things: [{ title: "work", state: "done" }] };
  const f = fixture(async () => { if (++calls === 1) throw Error("temporary failure"); return board; });
  f.applyRest(f.status());
  await f.flush();
  assert.equal(f.rest.error, true);
  assert.equal(calls, 1);
  f.clock.now += 2000;
  f.tickRest();
  assert.equal(f.rest.over, true);
  assert.equal(calls, 1, "does not hammer a failing host every second");
  f.clock.now += 3000;
  f.tickRest();
  await f.flush();
  assert.equal(f.rest.recap, board);
  assert.equal(f.rest.error, false);
  assert.equal(f.rest.status.phase, "resting", "completion waits for the person");
  assert.equal(f.rest.atEnd, true);
});

test("a successful early recap refreshes at the end, including agents that just finished", async () => {
  let calls = 0;
  const f = fixture(async () => ({ things: [{ state: ++calls === 1 ? "running" : "done" }] }));
  f.applyRest(f.status());
  await f.flush();
  assert.equal(f.rest.recap.things[0].state, "running");
  f.clock.now += 2000;
  f.tickRest();
  await f.flush();
  assert.equal(f.rest.recap.things[0].state, "done");
  f.tickRest();
  assert.equal(calls, 2);
});

test("an old recap cannot replace a new rest's board, even if a tab missed the idle phase", async () => {
  let finish;
  let calls = 0;
  const f = fixture(() => ++calls === 1 ? new Promise((r) => finish = r) : Promise.resolve({ things: ["new"] }));
  f.applyRest(f.status());
  f.applyRest(f.status(91000));
  await f.flush();
  finish({ things: ["old"] });
  await f.flush();
  assert.equal(f.rest.recap.things[0], "new");
  assert.equal(f.rest.loading, false);
});
