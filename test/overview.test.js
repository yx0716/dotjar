"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { page, feedback } = require("../src/overlay/overview-data");
const { entries, createStore } = require("../src/overlay/growth");

test("busy days preserve every task and star across pages, with original task identity", () => {
  const tasks = Array.from({ length: 13 }, (_, i) => ({ title: `Task ${i}`, from: `${22 - i}:00` }));
  const dots = Array.from({ length: 52 }, (_, i) => ({ id: `star-${i}`, task: i % 13 }));
  dots.push({ id: "loose", task: -1 }, { id: "stale", task: 99 }, { id: "missing" });
  const before = JSON.stringify({ tasks, dots });
  const pages = Array.from({ length: page(tasks, dots).pages }, (_, i) => page(tasks, dots, i));
  assert.equal(pages.length, 3);
  assert.deepEqual(pages.flatMap((p) => p.tasks.map((t) => t.overviewIndex)), tasks.map((_, i) => i).reverse());
  assert.deepEqual(pages.flatMap((p) => p.dots.map((d) => d.id)).sort(), dots.map((d) => d.id).sort());
  for (const p of pages) {
    assert.ok(p.tasks.length + Number(p.dots.some((d) => d.task === -1)) <= 6);
    for (const d of p.dots.filter((d) => d.task >= 0)) {
      assert.equal(p.tasks[d.task].overviewIndex, dots.find((original) => original.id === d.id).task);
    }
  }
  assert.equal(JSON.stringify({ tasks, dots }), before);
  assert.equal(page(tasks, dots, 99).current, 2);
  assert.equal(page([], [], 2).current, 0);
  assert.equal(page([], [{ id: "alone", task: 0 }]).dots[0].task, -1);
});

test("a late-night task follows the evening; all stars in a large cluster stay available", () => {
  const tasks = [{ from: "01:00" }, { from: "22:00" }, {}];
  const dots = Array.from({ length: 25 }, (_, i) => ({ id: i, task: 0 }));
  const result = page(tasks, dots);
  assert.deepEqual(result.tasks.map((t) => t.overviewIndex), [1, 0, 2]);
  assert.equal(result.dots.length, 25);
});

test("folding feedback preserves read state and source indices for checkbox and applied links", () => {
  const rows = entries({ highlight: "Good", next: "Next", applied: [{ title: "A" }, { title: "B" }] });
  const store = createStore(() => { throw Error("unavailable"); });
  const isRead = (r) => store.has("2026-11-11", r.key);
  assert.deepEqual([...feedback(rows, isRead, false).visible], [0, 3]);
  assert.equal(feedback(rows, isRead, false).hidden, 2);
  assert.equal(feedback(rows, isRead, true).visible.size, 4);
  assert.ok(rows.every((r) => !isRead(r)));
  store.set("2026-11-11", rows[0].key, true);
  assert.deepEqual([...feedback(rows, isRead, false).visible], [3, 1]);
  assert.deepEqual([...feedback(rows, isRead, true).visible], [1, 2, 3]);
  assert.equal(rows[1].n, 0);
});
