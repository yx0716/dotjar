"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const config = require("../core/config");
const { read, atomic, root, installation, newer, sleep } = require("./common");
const release = require("./release");
const operations = require("../core/operations");
const stateFile = () => path.join(config.dataDir(), "update-state.json");
const terminal = new Set(["completed", "rolled-back", "failed", "recovered"]);
function keys(base = root(), managed = installation().mode === "managed") {
  return read(managed ? path.join(base, "launcher/assets/update-keys.json") : path.resolve(__dirname, "../../assets/update-keys.json"), {});
}
function status() {
  const install = installation();
  const saved = read(stateFile(), {});
  const tx = install.mode === "managed" ? read(path.join(install.root, "transaction.json")) : null;
  return {
    current: install.current, mode: install.mode, supported: process.platform === "darwin",
    configured: Object.keys(keys()).length > 0,
    latest: saved.envelope?.manifest?.version || null, notes: saved.envelope?.manifest?.notes || "",
    available: Boolean(saved.envelope && newer(saved.envelope.manifest.version, install.current)),
    checkedAt: saved.checkedAt || null, error: saved.error || "", autoCheck: Boolean(saved.autoCheck), skipped: saved.skipped || null,
    job: tx ? { id: tx.id, version: tx.next.version, phase: tx.phase, error: tx.error || "" } : null,
  };
}
let checking;
async function check() {
  if (checking) return checking;
  checking = (async () => {
    let result;
    try {
      const trusted = keys();
      if (!Object.keys(trusted).length) throw new Error("发布签名尚未配置，暂时不能检查更新");
      result = { envelope: await release.latest(trusted), error: "" };
    } catch (err) { result = { error: err.message }; }
    atomic(stateFile(), { ...read(stateFile(), {}), ...result, checkedAt: new Date().toISOString() });
    return status();
  })().finally(() => { checking = null; });
  return checking;
}
function preferences(patch) {
  const saved = read(stateFile(), {});
  if (patch && typeof patch.autoCheck === "boolean") saved.autoCheck = patch.autoCheck;
  if (patch && "skipped" in patch) {
    if (patch.skipped !== null && patch.skipped !== saved.envelope?.manifest.version) throw new Error("只能跳过已经检查到的版本");
    saved.skipped = patch.skipped;
  }
  atomic(stateFile(), saved);
  return status();
}
async function start(version) {
  require("../core/instance").assertInstall();
  const install = installation();
  if (install.mode !== "managed" || process.platform !== "darwin") throw new Error("此安装由你管理，请先运行 dotjar install-managed 迁移到托管版");
  const envelope = read(stateFile(), {}).envelope;
  const m = release.verify(envelope, keys());
  if (m.version !== version || !newer(version, install.current)) throw new Error("请先检查更新，再选择已验证的新版本");
  const lock = read(path.join(install.root, "job-lock.json"));
  if (lock && operations.alive(lock.pid)) return status();
  const id = crypto.randomUUID();
  const out = fs.openSync(path.join(config.dataDir(), "update.log"), "a", 0o600);
  const child = spawn(process.execPath, [path.join(install.root, "launcher/src/update/worker.js"), id, version], {
    detached: true, stdio: ["ignore", out, out], env: { ...process.env, DOTJAR_HOME: config.dataDir(), DOTJAR_INSTALL_ROOT: install.root },
  });
  fs.closeSync(out);
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref();
  for (let i = 0; i < 30; i++) {
    const tx = read(path.join(install.root, "transaction.json"));
    if (tx?.id === id || (tx && !terminal.has(tx.phase))) return status();
    if (!operations.alive(child.pid)) throw new Error("更新进程未能启动，请查看 update.log");
    await sleep(100);
  }
  throw new Error("更新进程没有回应，请稍后查看更新状态");
}
function watch() {
  if (require("../core/instance").profile() !== "production") return () => {};
  const tick = () => {
    const saved = read(stateFile(), {});
    if (saved.autoCheck && Date.now() - (Date.parse(saved.checkedAt) || 0) >= 86400000) check().catch(() => {});
  };
  tick();
  const timer = setInterval(tick, 3600000); timer.unref();
  return () => clearInterval(timer);
}
module.exports = { status, check, preferences, start, watch, keys, terminal, stateFile };
