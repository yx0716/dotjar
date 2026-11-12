"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { scan, main } = require("../scripts/dev-clean");
const json = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };

test("dev:clean only offers data whose worktree is gone, and only moves it with --yes", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-devclean-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "dev"), live = path.join(dir, "live");
  fs.mkdirSync(path.join(live, ".git"), { recursive: true });
  const dev = (id, record, extra = {}) => {
    json(path.join(root, id, "instance.json"), { id: "x", profile: extra.profile || "dev" });
    if (record) json(path.join(root, id, "install.json"), record);
    if (extra.pid) json(path.join(root, id, "web.pid"), { pid: extra.pid, port: 1 });
  };
  dev("aaaaaaaaaaaa", { instance: { source: path.join(dir, "gone") } });
  fs.writeFileSync(path.join(root, "aaaaaaaaaaaa", "note.md"), "");
  fs.mkdirSync(path.join(root, "aaaaaaaaaaaa", "deposits"));
  fs.writeFileSync(path.join(root, "aaaaaaaaaaaa", "deposits", "kept.md"), "x");
  dev("bbbbbbbbbbbb", { bin: path.join(live, "bin/dotjar.js") });
  dev("cccccccccccc", { instance: { source: path.join(dir, "gone") } }, { pid: process.pid });
  dev("dddddddddddd", null);
  dev("eeeeeeeeeeee", { instance: { source: path.join(dir, "gone") } }, { profile: "production" });
  fs.mkdirSync(path.join(root, "not-an-id"));

  const states = Object.fromEntries(scan(root).map((e) => [e.id, e.state]));
  assert.deepEqual(states, { aaaaaaaaaaaa: "stale", bbbbbbbbbbbb: "in-use", cccccccccccc: "running", dddddddddddd: "unknown-source", eeeeeeeeeeee: "not-dev" });
  assert.equal(scan(root)[0].notes, 1);

  const trashed = [], logs = [];
  assert.deepEqual(main([], root, (f) => trashed.push(f), (s) => logs.push(s)), []);
  assert.deepEqual(trashed, []);
  assert.match(logs.join("\n"), /--yes/);
  main(["--yes"], root, (f) => trashed.push(f), () => {});
  assert.deepEqual(trashed, [path.join(root, "aaaaaaaaaaaa")]);
  assert.throws(() => main(["--all"], root), /用法/);
  assert.deepEqual(scan(path.join(dir, "missing")), []);
});

test("a source checkout refuses to act as the customer's copy unless isolation is explicit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-source-"));
  try {
    fs.mkdirSync(path.join(dir, ".git"));
    const check = (env) => {
      const clean = { ...process.env, ...env };
      for (const key of ["DOTJAR_PROFILE", "DOTJAR_HOME", "STRATA_HOME"]) if (!(key in env)) delete clean[key];
      return spawnSync(process.execPath, ["-e", `require("./src/core/instance").assertIsolatedSource(${JSON.stringify(dir)})`], { cwd: path.resolve(__dirname, ".."), env: clean, encoding: "utf8" });
    };
    assert.match(check({}).stderr, /npm run dev/);
    assert.equal(check({ DOTJAR_PROFILE: "dev", DOTJAR_HOME: path.join(dir, "data") }).status, 0);
    fs.rmSync(path.join(dir, ".git"), { recursive: true });
    assert.equal(check({}).status, 0, "an installed copy has no .git");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
