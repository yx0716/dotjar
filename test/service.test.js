"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const BIN = path.join(__dirname, "..", "bin", "dotjar.js");

test("managed background startup recognizes the supervised server and can stop and restart it", { timeout: 30000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-managed-start-"));
  const home = path.join(base, "data");
  const version = require("../package.json").version;
  const target = path.join(base, "releases", version);
  fs.mkdirSync(target, { recursive: true });
  for (const name of ["src", "bin", "package.json"]) {
    fs.cpSync(path.join(__dirname, "..", name), path.join(target, name), { recursive: true });
  }
  const bin = require("../src/update/install").bootstrap(base, version, home);
  const run = (...args) => spawnSync(process.execPath, [bin, ...args], {
    env: { ...process.env, DOTJAR_HOME: home }, encoding: "utf8", timeout: 15000,
  });
  t.after(() => { run("stop"); fs.rmSync(base, { recursive: true, force: true }); });
  let previousId;
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = run("web", "--no-open", "--port", "0");
    assert.equal(started.status, 0, started.stderr);
    const pid = JSON.parse(fs.readFileSync(path.join(home, "web.pid"), "utf8"));
    assert.ok(pid.startupId);
    assert.notEqual(pid.startupId, previousId);
    previousId = pid.startupId;
    const token = fs.readFileSync(path.join(home, "web-token"), "utf8").trim();
    const res = await fetch(`http://127.0.0.1:${pid.port}/api/updateHealth`, {
      method: "POST", headers: { cookie: `dotjar_token=${token}`, "x-dotjar": "1" },
    });
    assert.equal(res.status, 200);
    const health = (await res.json()).value;
    assert.equal(health.version, version);
    assert.equal(fs.realpathSync(health.root), fs.realpathSync(base));
    const again = run("web", "--no-open", "--port", "0");
    assert.equal(again.status, 0, again.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, "web.pid"), "utf8")).pid, pid.pid);
    assert.match(run("stop").stdout, /已停掉/);
    await assert.rejects(fetch(`http://127.0.0.1:${pid.port}/`));
  }
});

test("npm start leaves the web version running in the background, and stop ends it", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-svc-"));
  const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { env: { ...process.env, DOTJAR_HOME: home }, encoding: "utf8", timeout: 20000 });
  t.after(() => run("stop"));

  const started = run("web", "--no-open", "--port", "0");
  assert.equal(started.status, 0, started.stderr);
  const url = /http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+/.exec(started.stdout)[0];
  assert.ok(started.stdout.includes("这个终端可以关了"));

  // The command has returned, and the page is being served.
  const first = await fetch(url, { redirect: "manual" });
  assert.equal(first.status, 302);
  const pid = JSON.parse(fs.readFileSync(path.join(home, "web.pid"), "utf8"));
  assert.equal(String(pid.port), new URL(url).port);

  // Starting again finds the one already running instead of starting another.
  const again = run("web", "--no-open", "--port", "0");
  assert.ok(again.stdout.includes(url));
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, "web.pid"), "utf8")).pid, pid.pid);

  assert.match(run("stop").stdout, /已停掉/);
  await assert.rejects(fetch(url, { redirect: "manual" }));
  assert.ok(!fs.existsSync(path.join(home, "web.pid")));
  assert.match(run("stop").stdout, /没有在跑/);
});

test("the login service runs the same server, with what it needs to find the CLI", () => {
  const service = require("../src/service");
  const xml = service.plistXml({ node: "/opt/homebrew/bin/node", bin: "/Users/a&b/dotjar/bin/dotjar.js", log: "/tmp/dotjar.log", pathEnv: "/opt/homebrew/bin:/usr/bin" });
  assert.ok(xml.includes("<string>com.dotjar.web</string>"));
  assert.ok(xml.includes("<string>/Users/a&amp;b/dotjar/bin/dotjar.js</string>"), "paths are escaped");
  assert.ok(/<string>web<\/string>\s*<string>--foreground<\/string>\s*<string>--no-open<\/string>/.test(xml));
  assert.ok(xml.includes("<key>PATH</key><string>/opt/homebrew/bin:/usr/bin</string>"));
  assert.ok(xml.includes("<key>RunAtLoad</key><true/>") && xml.includes("<key>KeepAlive</key><true/>"));
});
