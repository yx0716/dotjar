"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const REPO = "yx0716/dotjar";
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function root() {
  const value = path.resolve(process.env.DOTJAR_INSTALL_ROOT || path.join(os.homedir(), ".local/share/dotjar"));
  return fs.existsSync(value) ? fs.realpathSync(value) : value;
}
function read(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { if (e.code === "ENOENT") return fallback; throw e; }
}
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
function releaseDir(base, version) {
  if (!VERSION.test(version)) throw new Error("无效的版本号");
  return path.join(base, "releases", version);
}
function newer(a, b) {
  if (!VERSION.test(a) || !VERSION.test(b)) throw new Error("无效的版本号");
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
function installation(base = root(), source = path.resolve(__dirname, "../..")) {
  const current = read(path.join(base, "current.json"));
  const managed = Boolean(current && source === releaseDir(base, require("../../package.json").version) && process.env.DOTJAR_MANAGED_ROOT === base);
  return { mode: managed ? "managed" : fs.existsSync(path.join(source, ".git")) ? "source" : "manual", root: base, current: require("../../package.json").version };
}
module.exports = { REPO, VERSION, sleep, root, read, atomic, releaseDir, newer, installation };
