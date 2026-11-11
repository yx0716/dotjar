"use strict";

// Invoked as the logged-in user by the native app, never by Installer/root.
// The app is read-only. Its bundled, signed release seeds a per-user managed
// installation once; later launches reuse that installation without downgrading.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { bootstrap } = require("./install");
const { read, releaseDir, root } = require("./common");
const release = require("./release");
const config = require("../core/config");
const operations = require("../core/operations");
const quote = (s) => "'" + s.replace(/'/g, "'\\''") + "'";

function existing(base) {
  const record = read(path.join(base, "installation.json"));
  const current = read(path.join(base, "current.json"));
  const bin = path.join(base, "launcher/bin/dotjar.js");
  if (record?.protocol !== 1 || !path.isAbsolute(record.dataDir || "") ||
      !path.isAbsolute(record.node || "") || !current ||
      !fs.existsSync(path.join(releaseDir(base, current.version), "bin/dotjar.js")) || !fs.existsSync(bin)) {
    throw new Error("已有安装不完整，已保留原文件。请查看安装与更新帮助，不要删除笔记目录。");
  }
  if (!fs.existsSync(record.node)) throw new Error("原安装使用的运行环境已被移除。请修复原安装的运行环境；已有记录和笔记未被修改。");
  const gate = read(path.join(record.dataDir, "operations/update.json"));
  if (gate && operations.alive(gate.pid)) throw new Error("dotjar 正在更新，请稍后再次打开。");
  return { bin, node: record.node, dataDir: record.dataDir, fresh: false };
}

function installOffline({ base, dataDir, payload, node, keys = read(path.resolve(__dirname, "../../assets/update-keys.json")) }) {
  if (fs.existsSync(base)) return existing(base);
  fs.mkdirSync(path.dirname(base), { recursive: true });
  const lock = base + ".install-lock";
  // An interrupted installation can be retried. A live installer is never
  // removed; exclusive creation arbitrates simultaneous double-clicks.
  try {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    const owner = read(lock);
    if (!Number.isInteger(owner?.pid) || owner.pid <= 0 || operations.alive(owner.pid)) throw new Error("另一个 dotjar 安装正在进行，请稍后再次打开。");
    fs.unlinkSync(lock);
    return installOffline({ base, dataDir, payload, node, keys });
  }
  let stage;
  try {
    if (fs.existsSync(base)) return existing(base);
    const manifest = release.verify(read(path.join(payload, "dotjar-update.json")), keys);
    stage = fs.mkdtempSync(base + ".install-");
    fs.mkdirSync(path.join(stage, "releases"));
    release.unpack(fs.readFileSync(path.join(payload, manifest.artifact.name)), manifest, releaseDir(stage, manifest.version));
    // Keep a stable runtime outside the .app, so deleting/moving the app or
    // replacing it with a later installer does not break a running service.
    const relativeNode = path.join("runtime", `node-${process.versions.node}-${process.arch}`, "bin/node");
    const stableNode = path.join(base, relativeNode);
    fs.mkdirSync(path.dirname(path.join(stage, relativeNode)), { recursive: true });
    fs.copyFileSync(node, path.join(stage, relativeNode));
    fs.chmodSync(path.join(stage, relativeNode), 0o755);
    fs.copyFileSync(path.join(payload, "NODE-LICENSE"), path.join(stage, "runtime/LICENSE"));
    bootstrap(stage, manifest.version, dataDir, stableNode);
    fs.renameSync(stage, base);
    stage = null;
    return { ...existing(base), fresh: true };
  } finally {
    if (stage) fs.rmSync(stage, { recursive: true, force: true });
    fs.unlinkSync(lock);
  }
}

async function main(resources, options = {}) {
  if (require("../core/instance").profile() !== "production") throw new Error("开发/验收环境请使用隔离的命令行入口，不安装系统应用入口");
  if (process.getuid?.() === 0) throw new Error("请从「应用程序」以自己的账号打开 dotjar，不要以管理员身份运行。");
  // Finder does not inherit a terminal's PATH. Include common CLI locations
  // without sourcing shell profiles or executing user startup scripts.
  process.env.PATH = [...new Set([path.join(os.homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", ...(process.env.PATH || "/usr/bin:/bin").split(":")])].join(":");
  const base = root();
  if (!fs.existsSync(base)) {
    const service = require("../service");
    const running = await service.running();
    if (running) {
      if (!options.noOpen) require("../server").openInBrowser(running.url);
      return { reusedRunning: true };
    }
    if (service.installed()) throw new Error("检测到旧版登录启动项。请先退出旧版并取消其自动启动，再打开 dotjar；原有数据会保留。");
  }
  const installed = installOffline({ base, dataDir: path.resolve(config.dataDir()), payload: path.join(resources, "payload"), node: process.execPath });
  // Convenient optional CLI entry. Never overwrite another program or symlink.
  const entry = path.join(os.homedir(), ".local/bin/dotjar");
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  try { fs.writeFileSync(entry, `#!/bin/sh\nexec ${quote(installed.node)} ${quote(installed.bin)} "$@"\n`, { flag: "wx", mode: 0o755 }); }
  catch (err) { if (err.code !== "EEXIST") throw err; }
  const saved = read(path.join(installed.dataDir, "install.json"), {}).port;
  const port = Number.isInteger(saved) && saved > 0 && saved <= 65535 ? saved : 4747;
  const args = [installed.bin, "web", "--port", String(port), ...(options.noOpen ? ["--no-open"] : [])];
  const started = spawnSync(installed.node, args, {
    env: { ...process.env, DOTJAR_HOME: installed.dataDir, DOTJAR_INSTALL_ROOT: base }, encoding: "utf8", timeout: 30000,
  });
  if (started.status !== 0) throw new Error(`程序已安装，但打开失败。${started.stderr?.trim() || started.error?.message || "请稍后重试。"}`);
  return { fresh: installed.fresh };
}
if (require.main === module) main(process.argv[2], { noOpen: process.argv.includes("--no-open") }).catch((err) => {
  console.error(err.message); process.exitCode = 1;
});
module.exports = { main, installOffline, existing };
