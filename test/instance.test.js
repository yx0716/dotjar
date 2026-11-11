"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const source = path.resolve(__dirname, ".."), bin = path.join(source, "bin/dotjar.js");
function setup(t, profile = "dev") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-instance-"));
  const env = { ...process.env, DOTJAR_HOME: dir, DOTJAR_PROFILE: profile, DOTJAR_INSTALL_ROOT: path.join(dir, "program"), DOTJAR_REAL_DATA: "0", DOTJAR_ALLOW_MODEL: "0" };
  for (const key of ["DOTJAR_MANAGED_ROOT", "DOTJAR_LAUNCHER", "ELECTRON_RUN_AS_NODE"]) delete env[key];
  const run = (...args) => spawnSync(process.execPath, [bin, ...args], { env, encoding: "utf8", timeout: 15000 });
  t.after(() => { run("stop"); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, env, run };
}
function evaluate(env, code) { return spawnSync(process.execPath, ["-e", code], { cwd: source, env, encoding: "utf8", timeout: 15000 }); }
async function open(instance) {
  const started = instance.run("web", "--no-open", "--port", "0");
  assert.equal(started.status, 0, started.stderr);
  const pid = JSON.parse(fs.readFileSync(path.join(instance.dir, "web.pid")));
  const token = fs.readFileSync(path.join(instance.dir, "web-token"), "utf8").trim();
  const url = `http://127.0.0.1:${pid.port}/`;
  const entry = await fetch(url + `?t=${token}`, { redirect: "manual" });
  return { pid, token, url, cookie: entry.headers.get("set-cookie").split(";")[0] };
}
test("development and customer services coexist in one cookie jar; stop/restart stays inside its instance", async t => {
  const prod = setup(t, "production"), dev = setup(t), second = setup(t);
  const p = await open(prod), d = await open(dev), s = await open(second);
  const jar = [p.cookie, d.cookie, s.cookie].join("; ");
  for (const item of [p, d, s]) assert.equal((await fetch(item.url, { headers: { cookie: jar } })).status, 200);
  assert.equal((await fetch(d.url, { headers: { cookie: p.cookie } })).status, 403);
  assert.notEqual(d.cookie.split("=")[0], s.cookie.split("=")[0]);
  assert.match(await (await fetch(d.url, { headers: { cookie: jar } })).text(), /开发版/);
  const blocked = await fetch(d.url + "api/today", { method: "POST", headers: { cookie: jar, "x-dotjar": "1" } });
  assert.equal(blocked.status, 400);
  assert.equal(dev.run("service", "uninstall").status, 1);
  assert.equal(dev.run("service", "install").status, 1);
  assert.equal(dev.run("install-managed").status, 1);
  assert.match(dev.run("stop").stdout, /已停掉/);
  assert.equal((await fetch(p.url, { headers: { cookie: jar } })).status, 200);
  assert.equal((await fetch(s.url, { headers: { cookie: jar } })).status, 200);
  const restarted = await open(dev);
  assert.equal(restarted.pid.instance.id, d.pid.instance.id);
  assert.equal(restarted.cookie, d.cookie);
});
test("a stale PID or a different source checkout cannot control an existing service", async t => {
  const dev = setup(t), started = await open(dev);
  const pidFile = path.join(dev.dir, "web.pid");
  fs.writeFileSync(pidFile, JSON.stringify({ ...started.pid, pid: process.pid }));
  assert.equal(dev.run("stop").status, 1);
  assert.equal((await fetch(started.url, { headers: { cookie: started.cookie } })).status, 200);
  fs.writeFileSync(pidFile, JSON.stringify(started.pid));
  const other = path.join(dev.dir, "other-source");
  fs.mkdirSync(other);
  for (const name of ["src", "bin", "package.json"]) fs.cpSync(path.join(source, name), path.join(other, name), { recursive: true });
  const wrong = spawnSync(process.execPath, [path.join(other, "bin/dotjar.js"), "stop"], { env: dev.env, encoding: "utf8" });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /另一份程序/);
  assert.equal((await fetch(started.url, { headers: { cookie: started.cookie } })).status, 200);
});
test("development rejects production paths, escaped note paths and model calls", t => {
  const dev = setup(t);
  const live = evaluate({ ...dev.env, DOTJAR_HOME: path.join(os.homedir(), ".dotjar") }, 'require("./src/core/instance").current()');
  assert.notEqual(live.status, 0);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-notes-"));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.symlinkSync(external, path.join(dev.dir, "outside"));
  const change = evaluate(dev.env, `require("./src/core/session").createSession().setDepositDir(${JSON.stringify(path.join(dev.dir, "outside/new"))})`);
  assert.notEqual(change.status, 0);
  assert.equal(fs.existsSync(path.join(external, "new")), false);
  for (const real of ["0", "1"]) {
    const call = evaluate({ ...dev.env, DOTJAR_REAL_DATA: real }, 'require("./src/core/instance").assertModel()');
    assert.notEqual(call.status, 0);
  }
  assert.equal(evaluate({ ...dev.env, DOTJAR_REAL_DATA: "1", DOTJAR_ALLOW_MODEL: "1" }, 'require("./src/core/instance").assertModel()').status, 0);
});

test("a bare source checkout cannot use the customer's default data", () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(DOTJAR_|STRATA_)/.test(key)) delete env[key];
  const started = spawnSync(process.execPath, [bin, "web", "--no-open"], { env, encoding: "utf8", timeout: 5000 });
  assert.equal(started.status, 1);
  assert.match(started.stderr, /npm run dev/);
});
test("installation verifier rejects ambiguous versions and unknown options", () => {
  const { options } = require("../scripts/verify-install");
  assert.deepEqual(options(["--version", "0.4.2", "--from", "0.4.1", "--candidate"]), { version: "0.4.2", from: "0.4.1", candidate: true });
  for (const args of [[], ["--version", "main"], ["--version", "0.4.2", "--from", "0.4.2"], ["--version", "0.4.2", "--force"]]) assert.throws(() => options(args));
});
