"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// Where the data lives, worked out in a fresh process with its own home.
function dataDirFor(home, env = {}) {
  const out = spawnSync(process.execPath, ["-e", "process.stdout.write(require('./src/core/config').dataDir())"], {
    cwd: path.join(__dirname, ".."),
    env: { PATH: process.env.PATH, HOME: home, ...env },
    encoding: "utf8",
  });
  return out.stdout;
}

test("data lives in ~/.dotjar, or in the old ~/.strata when that is all there is", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-home-"));
  assert.equal(dataDirFor(home), path.join(home, ".dotjar"));
  fs.mkdirSync(path.join(home, ".strata"));
  assert.equal(dataDirFor(home), path.join(home, ".strata"), "an install from before the rename keeps its data where it is");
  fs.mkdirSync(path.join(home, ".dotjar"));
  assert.equal(dataDirFor(home), path.join(home, ".dotjar"));
  assert.equal(dataDirFor(home, { DOTJAR_HOME: "/x" }), "/x");
  assert.equal(dataDirFor(home, { STRATA_HOME: "/y" }), "/y", "the old variable still works");
});
