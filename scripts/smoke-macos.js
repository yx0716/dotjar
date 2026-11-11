#!/usr/bin/env node
"use strict";
// Exercise the actual app's bundled runtime with an isolated user directory.
// No root installation, browser, model invocation or real user data is touched.
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const assert = require("assert/strict");
const { spawnSync } = require("child_process");
async function main(app) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-app-smoke-"));
  const data = path.join(home, ".dotjar"), base = path.join(home, ".local/share/dotjar");
  const resources = path.resolve(app, "Contents/Resources");
  const node = path.resolve(app, "Contents/MacOS/node");
  const entry = path.join(home, ".local/bin/dotjar");
  const env = { ...process.env, HOME: home, DOTJAR_HOME: data, DOTJAR_INSTALL_ROOT: base, PATH: "/usr/bin:/bin" };
  for (const key of ["NODE_OPTIONS", "NODE_PATH", "DOTJAR_MANAGED_ROOT", "DOTJAR_LAUNCHER", "ELECTRON_RUN_AS_NODE"]) delete env[key];
  const socket = net.createServer();
  await new Promise(r => socket.listen(0, "127.0.0.1", r));
  const port = socket.address().port;
  await new Promise(r => socket.close(r));
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, "install.json"), JSON.stringify({ port }));
  fs.writeFileSync(path.join(data, "config.json"), JSON.stringify({ rest: { enabled: false }, claudeDir: path.join(home, "no-claude"), codexDir: path.join(home, "no-codex"), noteDirs: [] }));
  fs.writeFileSync(path.join(data, "note.md"), "preserve this note");
  const open = () => spawnSync(node, [path.join(resources, "host/src/update/desktop.js"), resources, "--no-open"], { env, encoding: "utf8", timeout: 30000 });
  try {
    const installed = open();
    assert.equal(installed.status, 0, installed.stderr || installed.error?.message);
    const record = JSON.parse(fs.readFileSync(path.join(base, "installation.json")));
    assert.ok(record.node.startsWith(base + path.sep));
    const pid = JSON.parse(fs.readFileSync(path.join(data, "web.pid")));
    assert.equal(pid.port, port);
    const token = fs.readFileSync(path.join(data, "web-token"), "utf8").trim();
    const headers = { cookie: "dotjar_token=" + token, "x-dotjar": "1" };
    const res = await fetch(`http://127.0.0.1:${port}/api/updateHealth`, { method: "POST", headers });
    assert.equal(res.status, 200);
    const health = (await res.json()).value;
    const manifest = JSON.parse(fs.readFileSync(path.join(resources, "payload/dotjar-update.json"))).manifest;
    assert.equal(health.version, manifest.version);
    assert.equal(fs.realpathSync(health.root), fs.realpathSync(base));
    const again = open(); assert.equal(again.status, 0, again.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, "web.pid"))).pid, pid.pid);
    const stop = spawnSync(entry, ["stop"], { env, encoding: "utf8", timeout: 15000 });
    assert.equal(stop.status, 0, stop.stderr);
    const restart = spawnSync(entry, ["web", "--no-open", "--port", String(port)], { env, encoding: "utf8", timeout: 15000 });
    assert.equal(restart.status, 0, restart.stderr);
    assert.equal(fs.readFileSync(path.join(data, "note.md"), "utf8"), "preserve this note");
    console.log(JSON.stringify({ version: health.version, runtime: "bundled", systemNodeOnPath: false, offlineInstall: "passed", repeatOpen: "passed", stableRuntimeRestart: "passed", notes: "preserved" }));
  } finally {
    if (fs.existsSync(entry)) spawnSync(entry, ["stop"], { env, encoding: "utf8", timeout: 15000 });
    fs.rmSync(home, { recursive: true, force: true });
  }
}
if (require.main === module) main(process.argv[2] || "dist/macos/arm64/dotjar.app").catch(err => { console.error(err); process.exitCode = 1; });
module.exports = { main };
