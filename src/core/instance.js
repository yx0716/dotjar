"use strict";
// Instance identity is local to a data directory. It is not an OS sandbox.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
function canonical(file) {
  const full = path.resolve(file);
  if (fs.existsSync(full)) return fs.realpathSync(full);
  const parent = path.dirname(full);
  return parent === full ? full : path.join(canonical(parent), path.basename(full));
}
function defaultDataDir() {
  const fresh = path.join(os.homedir(), ".dotjar"), old = path.join(os.homedir(), ".strata");
  return !fs.existsSync(fresh) && fs.existsSync(old) ? old : fresh;
}
function profile() {
  const value = process.env.DOTJAR_PROFILE || "production";
  if (!["production", "dev", "verify"].includes(value)) throw new Error("无效的 dotjar 环境");
  return value;
}
function dataDir() {
  const value = path.resolve(process.env.DOTJAR_HOME || process.env.STRATA_HOME || defaultDataDir());
  const real = canonical(value);
  if (profile() !== "production") {
    if (!process.env.DOTJAR_HOME) throw new Error("隔离环境必须指定数据目录");
    for (const name of [".dotjar", ".strata"]) {
      const live = canonical(path.join(os.homedir(), name));
      if (real === live || real.startsWith(live + path.sep) || live.startsWith(real + path.sep)) throw new Error("隔离环境不能使用日常版数据目录");
    }
  }
  const record = path.join(value, "instance.json");
  if (fs.existsSync(record) && JSON.parse(fs.readFileSync(record, "utf8")).profile !== profile()) throw new Error("数据目录属于不同环境，未修改原数据");
  return value;
}
function current() {
  const data = dataDir(), mode = profile(), file = path.join(data, "instance.json");
  fs.mkdirSync(data, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(file)) {
    const tmp = file + "." + crypto.randomUUID();
    fs.writeFileSync(tmp, JSON.stringify({ id: crypto.randomUUID(), profile: mode }), { flag: "wx", mode: 0o600 });
    try { fs.linkSync(tmp, file); } catch (err) { if (err.code !== "EEXIST") throw err; }
    finally { fs.unlinkSync(tmp); }
  }
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!/^[a-f0-9-]{36}$/.test(saved.id) || saved.profile !== mode) throw new Error("数据目录的实例身份不匹配，未修改原数据");
  const source = canonical(process.env.DOTJAR_MANAGED_ROOT || path.resolve(__dirname, "../.."));
  const owner = crypto.createHash("sha256").update(source).digest("hex").slice(0, 24);
  // Retain the old production cookie so pre-existing launchers/updaters and
  // companions can still authenticate. Isolated environments never accept it.
  return { id: saved.id, profile: mode, dataDir: data, source, owner,
    cookie: mode === "production" ? "dotjar_token" : "dotjar_token_" + saved.id.replaceAll("-", "") };
}
function inside(file, directory = dataDir()) {
  const full = canonical(file), base = canonical(directory);
  return full === base || full.startsWith(base + path.sep);
}
function assertWrite(file) {
  if (profile() !== "production" && !inside(file)) throw new Error("开发/验收环境只能写入自己的数据目录");
}
function fixtures() { return profile() !== "production" && process.env.DOTJAR_REAL_DATA !== "1"; }
function assertModel() {
  if (profile() !== "production" && (fixtures() || process.env.DOTJAR_ALLOW_MODEL !== "1")) throw new Error("此环境未启用模型调用；开发时需同时指定 --real-data --allow-model");
}
function assertInstall() { if (profile() === "dev") throw new Error("开发版不安装或更新客户程序，请使用 npm run dev"); }
// A source checkout must opt into a data context of its own. Otherwise a plain
// `npm start` or `electron .` would quietly act as the customer's copy.
function assertIsolatedSource(source) {
  if (fs.existsSync(path.join(source, ".git")) && !process.env.DOTJAR_PROFILE && !process.env.DOTJAR_HOME && !process.env.STRATA_HOME) {
    throw new Error("这是开发源码，请用 npm run dev 启动隔离环境；客户版请使用已安装的 dotjar 入口");
  }
}
function assertService() { if (profile() !== "production") throw new Error("开发/验收环境不操作系统登录启动项"); }
module.exports = { canonical, defaultDataDir, profile, dataDir, current, inside, assertWrite, fixtures, assertModel, assertInstall, assertService, assertIsolatedSource };
