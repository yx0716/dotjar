"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const source = path.resolve(__dirname, ".."), bin = path.join(source, "bin/dotjar.js");
const quote = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const json = (file, value) => write(file, JSON.stringify(value));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// A managed installation, its entry and npx copies, all inside one folder the
// way verify:install lays them out. Never the person's own home.
function setup(t, profile = "verify") {
  const boundary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-uninstall-")));
  const data = path.join(boundary, "data"), base = path.join(boundary, "program"), entryDir = path.join(boundary, "bin"), cache = path.join(boundary, "npm-cache");
  const env = { ...process.env, DOTJAR_PROFILE: profile, DOTJAR_HOME: data, DOTJAR_INSTALL_ROOT: base, DOTJAR_VERIFY_ROOT: boundary, DOTJAR_REAL_DATA: "0", DOTJAR_ALLOW_MODEL: "0", npm_config_cache: cache };
  for (const key of ["DOTJAR_MANAGED_ROOT", "DOTJAR_LAUNCHER", "ELECTRON_RUN_AS_NODE"]) delete env[key];
  const run = (...args) => spawnSync(process.execPath, [bin, ...args], { env, encoding: "utf8", timeout: 20000 });
  t.after(() => { run("stop"); fs.rmSync(boundary, { recursive: true, force: true }); });
  return { boundary, data, base, entryDir, cache, env, run };
}

function managed(s) {
  const made = spawnSync(process.execPath, ["-e", `require("./src/update/install").bootstrap(${JSON.stringify(s.base)}, "0.4.2", ${JSON.stringify(s.data)})`], { cwd: source, env: s.env, encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  write(path.join(s.base, "releases/0.4.2/bin/dotjar.js"), "// release\n");
  const launcher = path.join(s.base, "launcher/bin/dotjar.js");
  write(path.join(s.entryDir, "dotjar"), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(launcher)} "$@"\n`);
  json(path.join(s.cache, "_npx/aaaa/package.json"), { dependencies: { dotjar: "github:yx0716/dotjar" }, _npx: { packages: ["github:yx0716/dotjar"] } });
  json(path.join(s.cache, "_npx/bbbb/package.json"), { dependencies: { cowsay: "^1.0.0" }, _npx: { packages: ["cowsay"] } });
  // `npx /path/to/checkout` links the checkout into npx's folder; removing the
  // folder must remove the link, never what it points to.
  write(path.join(s.boundary, "checkout/bin/dotjar.js"), "// source\n");
  json(path.join(s.cache, "_npx/cccc/package.json"), { dependencies: { dotjar: "file:../checkout" }, _npx: { packages: [path.join(s.boundary, "checkout")] } });
  fs.mkdirSync(path.join(s.cache, "_npx/cccc/node_modules"), { recursive: true });
  fs.symlinkSync(path.join(s.boundary, "checkout"), path.join(s.cache, "_npx/cccc/node_modules/dotjar"));
  write(path.join(s.data, "deposits/keep.md"), "a note that must survive\n");
  json(path.join(s.data, "config.json"), { rest: { enabled: false } });
  json(path.join(s.data, "install.json"), { bin: launcher, port: 4747 });
  return launcher;
}

test("uninstall lists first, needs confirmation, then removes program files and keeps records and notes", (t) => {
  const s = setup(t);
  managed(s);
  const preview = s.run("uninstall", "--entry-dir", s.entryDir);
  assert.equal(preview.status, 1, "a non-interactive run without --yes changes nothing");
  assert.match(preview.stdout, /删除托管程序/);
  assert.match(preview.stdout, /删除命令入口/);
  assert.match(preview.stdout, /删除 npx 缓存（github:yx0716\/dotjar）/);
  assert.match(preview.stdout, /数据目录 .*保留/);
  assert.match(preview.stderr, /--yes/);
  assert.ok(fs.existsSync(s.base) && fs.existsSync(path.join(s.entryDir, "dotjar")));

  const done = s.run("uninstall", "--entry-dir", s.entryDir, "--yes");
  assert.equal(done.status, 0, done.stderr);
  assert.equal(fs.existsSync(s.base), false);
  assert.equal(fs.existsSync(path.join(s.entryDir, "dotjar")), false);
  assert.equal(fs.existsSync(path.join(s.cache, "_npx/aaaa")), false);
  assert.ok(fs.existsSync(path.join(s.cache, "_npx/bbbb")), "another package's npx copy is not ours");
  assert.equal(fs.existsSync(path.join(s.cache, "_npx/cccc")), false);
  assert.equal(fs.readFileSync(path.join(s.boundary, "checkout/bin/dotjar.js"), "utf8"), "// source\n", "a linked checkout survives");
  assert.equal(fs.readFileSync(path.join(s.data, "deposits/keep.md"), "utf8"), "a note that must survive\n");
  assert.ok(fs.existsSync(path.join(s.data, "config.json")));
  assert.equal(fs.existsSync(path.join(s.data, "install.json")), false, "the record of a removed program goes with it");

  assert.match(s.run("uninstall", "--entry-dir", s.entryDir, "--yes").stdout, /没有可以卸载/);
});

test("a running service is stopped before anything is removed", async (t) => {
  const s = setup(t);
  json(path.join(s.data, "config.json"), { rest: { enabled: false } });
  const started = s.run("web", "--no-open", "--port", "0");
  assert.equal(started.status, 0, started.stderr);
  const { pid } = JSON.parse(fs.readFileSync(path.join(s.data, "web.pid"), "utf8"));
  assert.ok(alive(pid));
  const done = s.run("uninstall", "--entry-dir", s.entryDir, "--yes");
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, new RegExp(`已停止后台服务（PID ${pid}）`));
  assert.equal(alive(pid), false);
  assert.equal(fs.existsSync(path.join(s.data, "web.pid")), false);
});

test("entries and installations that belong to someone else are left alone", (t) => {
  const s = setup(t);
  managed(s);
  write(path.join(s.entryDir, "dotjar"), "#!/bin/sh\necho mine\n");
  json(path.join(s.base, "installation.json"), { protocol: 1, dataDir: path.join(s.boundary, "elsewhere") });
  const done = s.run("uninstall", "--entry-dir", s.entryDir, "--yes");
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /属于另一个数据目录/);
  assert.match(done.stdout, /不是 dotjar 写入的命令入口/);
  assert.ok(fs.existsSync(s.base));
  assert.equal(fs.readFileSync(path.join(s.entryDir, "dotjar"), "utf8"), "#!/bin/sh\necho mine\n");
});

test("--purge takes the data folder too; development instances refuse", (t) => {
  const s = setup(t);
  managed(s);
  const done = s.run("uninstall", "--entry-dir", s.entryDir, "--purge", "--yes");
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /含 1 篇收下的笔记/);
  assert.equal(fs.existsSync(s.data), false);
  assert.equal(fs.existsSync(s.base), false);

  const dev = setup(t, "dev");
  const refused = dev.run("uninstall", "--yes");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /npm run dev:clean/);
});

test("verification uninstall cannot reach outside its own folder", (t) => {
  const s = setup(t);
  const refused = s.run("uninstall", "--yes");
  assert.equal(refused.status, 1, "the default ~/.local/bin is outside the verification folder");
  assert.match(refused.stderr, /验收目录/);
});

test("production: login item, administrator steps, Trash and notes kept outside the data folder", { skip: process.platform !== "darwin" }, (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-uninstall-prod-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const data = path.join(dir, "data"), notes = path.join(dir, "notes"), agents = path.join(dir, "LaunchAgents");
  const id = "11111111-2222-3333-4444-555555555555";
  json(path.join(data, "instance.json"), { id, profile: "production" });
  json(path.join(data, "config.json"), { depositDir: notes });
  write(path.join(notes, "kept.md"), "outside\n");
  write(path.join(agents, `com.dotjar.web.${id}.plist`), "<plist><dict><key>Label</key><string>x</string><key>ProgramArguments</key>\n<array>\n<string>/node</string>\n<string>/somewhere/bin/dotjar.js</string>\n</array></dict></plist>");
  fs.mkdirSync(path.join(dir, "dotjar.app"));
  const script = `
    const u = require("./src/uninstall");
    const calls = [], trashed = [];
    const options = { purge: true, base: ${JSON.stringify(path.join(dir, "program"))}, entryDir: ${JSON.stringify(path.join(dir, "bin"))},
      npmCache: ${JSON.stringify(path.join(dir, "npm"))}, launchAgents: ${JSON.stringify(agents)}, app: ${JSON.stringify(path.join(dir, "dotjar.app"))},
      legacy: ${JSON.stringify(path.join(dir, "strata"))}, uid: 501,
      run: (cmd, args) => { calls.push([cmd, ...args]); return { status: 0, stdout: cmd === "pkgutil" ? "com.dotjar.installer.arm64\\n" : "" }; },
      trash: (file) => trashed.push(file) };
    const p = u.plan(options);
    u.execute(p, options).then((done) => console.log(JSON.stringify({ p, calls, trashed, lines: u.describe(p), done })));`;
  const env = { ...process.env, DOTJAR_HOME: data };
  for (const key of ["DOTJAR_PROFILE", "DOTJAR_VERIFY_ROOT", "DOTJAR_INSTALL_ROOT", "DOTJAR_MANAGED_ROOT", "DOTJAR_LAUNCHER"]) delete env[key];
  const res = spawnSync(process.execPath, ["-e", script], { cwd: source, env, encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  const { p, calls, trashed, lines } = JSON.parse(res.stdout);
  assert.equal(p.loginItem.label, `com.dotjar.web.${id}`);
  assert.equal(p.loginItem.program, "/somewhere/bin/dotjar.js");
  assert.deepEqual(calls.find((c) => c[0] === "launchctl"), ["launchctl", "bootout", `gui/501/com.dotjar.web.${id}`]);
  assert.equal(fs.existsSync(path.join(agents, `com.dotjar.web.${id}.plist`)), false);
  assert.deepEqual(trashed, [data]);
  assert.ok(p.manual.some((s) => s.includes("sudo pkgutil --forget com.dotjar.installer.arm64")));
  assert.ok(p.manual.some((s) => s.includes("应用程序")));
  assert.ok(lines.some((s) => s.includes(notes) && s.includes("不会被删除")));
  assert.equal(fs.readFileSync(path.join(notes, "kept.md"), "utf8"), "outside\n");
});
