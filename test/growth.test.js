"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { entries, createStore } = require("../src/overlay/growth");

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}

test("read feedback survives reload, stays with its day and content, and can be restored", () => {
  const disk = storage();
  const g = { highlight: "Good", applied: [{ title: "First", how: "Example" }, { title: "Second", how: "Another" }], next: "Next" };
  const row = entries(g)[1];
  const store = createStore(() => disk);
  assert.equal(store.set("2026-11-11", row.key, true), true);
  const reloaded = createStore(() => disk);
  assert.equal(reloaded.has("2026-11-11", entries({ ...g, applied: [...g.applied].reverse() })[2].key), true);
  assert.equal(reloaded.has("2026-11-12", row.key), false);
  assert.equal(reloaded.has("2026-11-11", entries({ applied: [{ title: "First", how: "New evidence" }] })[0].key), false);
  reloaded.set("2026-11-11", row.key, false);
  assert.equal(store.has("2026-11-11", row.key), false);
  assert.equal(createStore(() => disk, "demo").has("2026-11-11", row.key), false);
});

test("unavailable or full storage still lets feedback be tucked away in this page", () => {
  for (const getStorage of [() => { throw Error("disabled"); }, () => ({ getItem: () => null, setItem: () => { throw Error("full"); } })]) {
    const store = createStore(getStorage);
    assert.equal(store.set("2026-11-11", "row", true), false);
    assert.equal(store.has("2026-11-11", "row"), true);
    store.set("2026-11-11", "row", false);
    assert.equal(store.has("2026-11-11", "row"), false);
  }
});

test("local read history is bounded and tolerates damaged data", () => {
  const disk = storage();
  disk.setItem("dotjar.growth.read.v1", "broken JSON");
  const store = createStore(() => disk);
  assert.equal(store.has("2026-11-01", "row"), false);
  for (let i = 1; i <= 30; i++) store.set(`2026-10-${String(i).padStart(2, "0")}`, "row", true);
  store.set("2026-11-01", "row", true);
  assert.equal(store.has("2026-10-01", "row"), false);
  assert.equal(store.has("2026-11-01", "row"), true);
});
