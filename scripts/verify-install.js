#!/usr/bin/env node
"use strict";
// Runs the npm entry point and real signed releases. Never changes HOME, the
// OS login session, production PATH entries, or the customer's installation.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const net = require("net");
const assert = require("assert/strict");
const { spawn } = require("child_process");
const { VERSION, newer } = require("../src/update/common");
const release = require("../src/update/release");
const source = path.resolve(__dirname, "..");
function options(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--candidate", "--keep"].includes(arg)) out[arg.slice(2)] = true;
    else if (["--version", "--from"].includes(arg)) {
      if (!VERSION.test(args[i + 1] || "")) throw new Error(`${arg} 需要稳定版本号，例如 0.4.2`);
      out[arg.slice(2)] = args[++i];
    } else throw new Error(`未知参数：${arg}`);
  }
  if (!out.version) throw new Error("用法：npm run verify:install -- --version <版本> [--from <旧版>] [--candidate] [--keep]");
  if (out.from && !newer(out.version, out.from)) throw new Error("目标版本必须高于旧版");
  return out;
}
function command(file, args, env, cwd, log, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", b => { stdout += b; }); child.stderr.on("data", b => { stderr += b; });
    const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
    child.once("error", e => { clearTimeout(timer); reject(e); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      fs.appendFileSync(log, `${file} ${args.join(" ")}\n${stdout}${stderr}\n`, { mode: 0o600 });
      if (code !== 0) reject(new Error(`${path.basename(file)} 执行失败（${signal || code}），请查看验收日志`));
      else resolve(stdout);
    });
  });
}
function fingerprint() {
  const home = os.homedir();
  const files = [".local/bin/dotjar", ".local/share/dotjar/current.json", ".local/share/dotjar/installation.json", ".dotjar/web.pid", ".dotjar/config.json", ".strata/web.pid", ".strata/config.json", "Library/LaunchAgents/com.dotjar.web.plist"];
  return Object.fromEntries(files.map(name => {
    const p = path.join(home, name);
    try { return [name, crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")]; }
    catch (e) { if (e.code === "ENOENT") return [name, null]; throw e; }
  }));
}
async function main(args = process.argv.slice(2)) {
  const opts = options(args);
  if (process.platform !== "darwin") throw new Error("托管安装验收目前需要 macOS");
  const boundary = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-install-verify-"));
  const data = path.join(boundary, "data"), base = path.join(boundary, "program"), entryDir = path.join(boundary, "bin");
  const entry = path.join(entryDir, "dotjar"), log = path.join(boundary, "commands.log");
  const before = fingerprint();
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(DOTJAR_|STRATA_|npm_config_|NPM_CONFIG_)/.test(key)) delete env[key];
  for (const key of ["NODE_OPTIONS", "NODE_PATH", "ELECTRON_RUN_AS_NODE"]) delete env[key];
  Object.assign(env, { DOTJAR_PROFILE: "verify", DOTJAR_HOME: data, DOTJAR_INSTALL_ROOT: base, DOTJAR_VERIFY_ROOT: boundary,
    DOTJAR_REAL_DATA: "0", DOTJAR_ALLOW_MODEL: "0", npm_config_cache: path.join(boundary, "npm-cache"),
    npm_config_userconfig: path.join(boundary, "npmrc"), npm_config_ignore_scripts: "true" });
  fs.writeFileSync(env.npm_config_userconfig, ""); fs.mkdirSync(data);
  // Reserve an available port, then release it immediately before installation.
  const socket = net.createServer(); await new Promise(r => socket.listen(0, "127.0.0.1", r));
  const port = socket.address().port; await new Promise(r => socket.close(r));
  fs.writeFileSync(path.join(data, "install.json"), JSON.stringify({ port }));
  fs.writeFileSync(path.join(data, "config.json"), JSON.stringify({ rest: { enabled: false }, claudeDir: path.join(boundary, "no-claude"), codexDir: path.join(boundary, "no-codex"), agentHome: boundary, noteDirs: [] }));
  fs.mkdirSync(path.join(data, "deposits")); fs.writeFileSync(path.join(data, "deposits/keep.md"), "installation verification note\n");
  const run = (file, argv) => command(file, argv, env, boundary, log);
  const report = { installer: opts.candidate ? "local npm pack via npx (not a published installer)" : `github:yx0716/dotjar#v${opts.version}`, target: opts.version, from: opts.from || null, checks: [], limitations: ["No login/reboot, Gatekeeper or OS sandbox verification", "Crash rollback is covered by test/update.test.js, not by altering public releases"] };
  let passed = false, stopped = true;
  const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
  const auth = () => {
    const token = fs.readFileSync(path.join(data, "web-token"), "utf8").trim();
    const instance = fs.existsSync(path.join(data, "instance.json")) ? read(path.join(data, "instance.json")) : null;
    return `dotjar_token=${token}${instance ? `; dotjar_token_${instance.id.replaceAll("-", "")}=${token}` : ""}`;
  };
  const call = async (name, args = []) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/${name}`, { method: "POST", headers: { cookie: auth(), "x-dotjar": "1", "content-type": "application/json" }, body: JSON.stringify({ args }), signal: AbortSignal.timeout(5000) });
    const body = await res.json(); if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`); return body.value;
  };
  const health = async version => {
    const h = await call("updateHealth");
    assert.equal(h.version, version); assert.equal(fs.realpathSync(h.root), fs.realpathSync(base)); assert.equal(fs.realpathSync(h.dataDir), fs.realpathSync(data));
    return h;
  };
  console.log(`验收目录：${boundary}\n安装器：${report.installer}\n目标发布包：${opts.version}`);
  try {
    let pkg = report.installer;
    if (opts.candidate) {
      const packed = JSON.parse(await command("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", boundary], env, source, log));
      pkg = path.join(boundary, packed[0].filename);
    }
    const npxArgs = ["--yes", "--ignore-scripts", "--package", pkg, "--", "dotjar"];
    const help = await run("npx", [...npxArgs, "--help"]);
    // Older releases ignore isolation options and write ~/.local/bin/dotjar.
    // Fail before installation instead of treating them as safe test targets.
    if (!help.includes("--entry-dir")) throw new Error("这个发布版安装器还不支持隔离入口，未执行安装。使用 --candidate 验证本次安装器，或在独立 macOS 测试账号验收旧安装器。");
    console.log("正在通过 npx 安装并验证签名发布包…");
    stopped = false;
    await run("npx", [...npxArgs, "install-managed", "--version", opts.from || opts.version, "--entry-dir", entryDir]);
    await health(opts.from || opts.version); report.checks.push("npx install exit status and signed release version/root/data");
    const pid = read(path.join(data, "web.pid")).pid;
    await run(entry, ["web", "--no-open", "--port", String(port)]);
    assert.equal(read(path.join(data, "web.pid")).pid, pid); report.checks.push("repeat open reuses service");
    await run(entry, ["stop"]); stopped = true;
    await assert.rejects(fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }));
    await run(entry, ["web", "--no-open", "--port", String(port)]); stopped = false;
    await health(opts.from || opts.version); report.checks.push("stop and restart");
    if (opts.from) {
      console.log(`正在验证 ${opts.from} → ${opts.version} 更新…`);
      const envelope = await release.latest(require("../assets/update-keys.json"), fetch, opts.version);
      fs.writeFileSync(path.join(data, "update-state.json"), JSON.stringify({ envelope }));
      await call("updateInstall", [opts.version]);
      const deadline = Date.now() + 120000;
      while (true) {
        const tx = fs.existsSync(path.join(base, "transaction.json")) ? read(path.join(base, "transaction.json")) : null;
        if (tx?.phase === "completed") break;
        if (["failed", "rolled-back", "recovered", "recovery-needed"].includes(tx?.phase)) throw new Error(`更新未完成：${tx.phase} ${tx.error || ""}`);
        if (Date.now() > deadline) throw new Error("更新验收超时");
        await new Promise(r => setTimeout(r, 500));
      }
      await health(opts.version); report.checks.push("upgrade through installed service and supervisor");
    }
    assert.equal(fs.readFileSync(path.join(data, "deposits/keep.md"), "utf8"), "installation verification note\n");
    assert.equal(read(path.join(data, "config.json")).rest.enabled, false);
    report.checks.push("notes and settings preserved");
    assert.deepEqual(fingerprint(), before); report.checks.push("production entry, pointers, PID, config and login item unchanged");
    passed = true;
  } catch (err) { report.error = err.message; throw err; }
  finally {
    if (!stopped && fs.existsSync(entry)) {
      try {
        // Authenticate the expected data/root before invoking even an old stop command.
        const h = await call("updateHealth");
        if (fs.realpathSync(h.root) !== fs.realpathSync(base) || fs.realpathSync(h.dataDir) !== fs.realpathSync(data)) throw new Error("清理时发现非验收服务，未停止");
        await run(entry, ["stop"]);
        await assert.rejects(fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }));
        stopped = true;
      } catch (err) { passed = false; report.cleanupError = err.message; }
    }
    if (!stopped) { passed = false; report.cleanupError ||= "启动失败后进程状态未确认，保留现场"; }
    try { assert.deepEqual(fingerprint(), before); } catch { passed = false; report.isolationError = "日常版关键文件发生变化；可能有并行操作，请检查后重试"; }
    report.passed = passed;
    fs.writeFileSync(path.join(boundary, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (passed && !opts.keep) { fs.rmSync(boundary, { recursive: true, force: true }); console.log("验收通过，已清理本次临时目录。"); }
    else console.log(`日志和现场保留在 ${boundary}`);
    if (!passed) process.exitCode = 1;
  }
}
if (require.main === module) main().catch(err => { console.error(err.message); process.exitCode = 1; });
module.exports = { options, main };
