"use strict";

// Keeping the web version running without a terminal held open.
//
// Two levels. `dotjar web` starts the server as a background process, good
// until the next restart of the machine. `dotjar service install` hands it to
// the system (launchd on macOS), which starts it at login and keeps it up, so
// that all there is to do afterwards is open a bookmark.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");
const { spawn, spawnSync } = require("child_process");

const config = require("./core/config");
const server = require("./server");

const instance = require("./core/instance");
const LABEL = "com.dotjar.web";
const BIN = process.env.DOTJAR_LAUNCHER || path.join(__dirname, "..", "bin", "dotjar.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pidFile() {
  return path.join(config.dataDir(), "web.pid");
}

function logFile() {
  return path.join(config.dataDir(), "web.log");
}

function writePid(port) {
  fs.mkdirSync(config.dataDir(), { recursive: true });
  const startupId = process.env.DOTJAR_STARTUP_ID;
  fs.writeFileSync(pidFile(), JSON.stringify({ pid: process.pid, port, instance: instance.current(), ...(startupId ? { startupId } : {}) }));
  // Where this dotjar lives, so a desktop companion can start it again later.
  try {
    fs.writeFileSync(path.join(config.dataDir(), "install.json"), JSON.stringify({ bin: BIN, port, instance: instance.current() }));
  } catch {
    // only a convenience
  }
}

function readPid() {
  try {
    const data = JSON.parse(fs.readFileSync(pidFile(), "utf8"));
    return data && Number.isInteger(data.pid) && Number.isInteger(data.port) ? data : null;
  } catch {
    return null;
  }
}

function clearPid() {
  try {
    if ((readPid() || {}).pid === process.pid) fs.unlinkSync(pidFile());
  } catch {
    // already gone
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// The server already running for this data folder, if there is one.
async function running() {
  const known = readPid();
  if (known && alive(known.pid)) {
    const found = await server.find({ port: known.port, span: 1 });
    if (found && found.pid === known.pid) return { ...found, pid: known.pid };
    throw new Error("后台进程身份与记录不符，请用原安装入口处理；未停止任何进程");
  }
  return server.find({});
}

// A server process of its own, writing to the log, outliving whoever started it.
function spawnServer(port, startupId = randomUUID()) {
  fs.mkdirSync(config.dataDir(), { recursive: true });
  const out = fs.openSync(logFile(), "a");
  const args = [BIN, "web", "--foreground", "--no-open"];
  if (port != null) args.push("--port", String(port));
  const child = spawn(process.execPath, args, { detached: true, stdio: ["ignore", out, out], env: { ...process.env, DOTJAR_STARTUP_ID: startupId } });
  child.unref();
  fs.closeSync(out);
  return child;
}

// Start the server detached from this terminal and wait until it answers.
async function startInBackground(options = {}) {
  const before = readPid();
  const startupId = randomUUID();
  spawnServer(options.port, startupId);
  for (let waited = 0; waited < 8000; waited += 150) {
    await sleep(150);
    const now = readPid();
    // Managed installs spawn a supervisor, whose child owns the HTTP server.
    // Correlate this launch through its environment instead of comparing PIDs;
    // a different server or a stale pid file must not count as our startup.
    if (now && now.startupId === startupId && alive(now.pid) && (!before || before.pid !== now.pid)) {
      const found = await server.find({ port: now.port, span: 1 });
      if (found) return { ...found, pid: now.pid };
    }
  }
  throw new Error(`后台服务没起来，看一下 ${config.tildify(logFile())}`);
}

async function stop() {
  const known = readPid();
  if (!known || !alive(known.pid)) return false;
  const found = await running();
  if (!found || found.pid !== known.pid) throw new Error("无法核实后台进程身份，未停止任何进程");
  process.kill(known.pid, "SIGTERM");
  for (let waited = 0; waited < 4000 && alive(known.pid); waited += 100) await sleep(100);
  try {
    if (readPid()?.pid === known.pid) fs.unlinkSync(pidFile());
  } catch {
    // the server removed it on its way out
  }
  return true;
}

// ----------------------------------------------------------------- launchd

function label() {
  return config.dataDir() === instance.defaultDataDir() ? LABEL : `${LABEL}.${instance.current().id}`;
}
function plistPath() {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${label()}.plist`);
}

function xml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plistXml(options = {}) {
  const node = options.node || process.execPath;
  const env = { PATH: options.pathEnv || process.env.PATH || "/usr/bin:/bin", HOME: os.homedir() };
  const home = process.env.DOTJAR_HOME || process.env.STRATA_HOME;
  if (home) env.DOTJAR_HOME = home;
  const args = [node, options.bin || BIN, "web", "--foreground", "--no-open"];
  if (options.port) args.push("--port", String(options.port));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label()}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xml(a)}</string>`).join("\n")}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env)
  .map(([k, v]) => `    <key>${xml(k)}</key><string>${xml(v)}</string>`)
  .join("\n")}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(options.log || logFile())}</string>
  <key>StandardErrorPath</key><string>${xml(options.log || logFile())}</string>
</dict>
</plist>
`;
}

function installed() {
  if (instance.profile() !== "production" || process.platform !== "darwin" || !fs.existsSync(plistPath())) return false;
  const text = fs.readFileSync(plistPath(), "utf8");
  if (!text.includes(`<string>${xml(BIN)}</string>`)) throw new Error("登录启动项属于另一份程序，请通过原安装入口管理");
  return true;
}

function launchctl(...args) {
  return spawnSync("launchctl", args, { encoding: "utf8" });
}

// Hand the server to launchd: started at login, restarted if it stops.
async function install() {
  instance.assertService();
  installed(); // refuse to replace another installation

  if (process.platform !== "darwin") throw new Error("开机自启目前只做了 macOS。其他系统请把 `node bin/dotjar.js web --foreground --no-open` 加进自己的启动项。");
  const savedPort = readPid()?.port;
  await stop(); // a copy started by hand would hold the port
  fs.mkdirSync(path.dirname(plistPath()), { recursive: true });
  fs.mkdirSync(config.dataDir(), { recursive: true });
  fs.writeFileSync(plistPath(), plistXml({ port: savedPort }));
  const domain = `gui/${process.getuid()}`;
  launchctl("bootout", `${domain}/${label()}`); // replace an earlier install; fine if there was none
  const res = launchctl("bootstrap", domain, plistPath());
  if (res.status !== 0) throw new Error(`launchctl 没装上：${(res.stderr || res.stdout || "").trim()}`);
  for (let waited = 0; waited < 8000; waited += 200) {
    await sleep(200);
    const found = await running();
    if (found) return found;
  }
  throw new Error(`装上了，但服务没应答，看一下 ${config.tildify(logFile())}`);
}

// Have launchd stop the server and start it again straight away.
function kickstart() {
  instance.assertService();
  if (!installed()) throw new Error("没有属于当前程序的登录启动项");
  launchctl("kickstart", "-k", `gui/${process.getuid()}/${label()}`);
}

// A server already running, replaced first if its code is older than the
// files on disk.
async function current() {
  const found = await running();
  if (!found) return null;
  // Up to date, or not one this folder started (no pid to stop it by). A
  // server that does not say how old it is predates saying so.
  if (found.code >= server.codeStamp() || (!found.pid && !installed())) return { ...found, fresh: false };
  if (installed()) {
    kickstart();
    for (let waited = 0; waited < 12000; waited += 300) {
      await sleep(300);
      const now = await running();
      if (now && now.pid !== found.pid) return { ...now, fresh: true };
    }
    throw new Error(`服务没重启起来，看一下 ${config.tildify(logFile())}`);
  }
  await stop();
  return { ...(await startInBackground({ port: found.port })), fresh: true };
}

function uninstall() {
  instance.assertService();
  if (!installed()) return false;
  launchctl("bootout", `gui/${process.getuid()}/${label()}`);
  fs.unlinkSync(plistPath());
  return true;
}

module.exports = { LABEL, pidFile, logFile, writePid, readPid, clearPid, running, current, spawnServer, startInBackground, stop, kickstart, plistPath, plistXml, installed, install, uninstall };
