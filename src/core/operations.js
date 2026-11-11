"use strict";

// A cross-process admission gate, shared by CLI, web and Electron. An updater
// closes admission before waiting for existing operations; no model is killed.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");
const context = new AsyncLocalStorage();
const base = () => path.join(require("./config").dataDir(), "operations");
const gateFile = () => path.join(base(), "update.json");
function read(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code === "ENOENT") return null; throw e; } }
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== "ESRCH"; } }
function blocked() {
  if (fs.existsSync(gateFile())) {
    const err = new Error("正在安装更新，请稍后再试");
    err.code = "UPDATING";
    throw err;
  }
}
function run(fn, ...args) {
  if (context.getStore()?.base === base() && context.getStore().active) return fn(...args);
  blocked();
  fs.mkdirSync(base(), { recursive: true });
  const file = path.join(base(), `${process.pid}-${crypto.randomUUID()}.json`);
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 });
  const scope = { base: base(), active: true };
  const done = () => { scope.active = false; try { fs.unlinkSync(file); } catch (e) { if (e.code !== "ENOENT") throw e; } };
  try {
    blocked(); // closes the registration/admission race
    const result = context.run(scope, () => fn(...args));
    if (result && typeof result.then === "function") return Promise.resolve(result).finally(done);
    done();
    return result;
  } catch (err) { done(); throw err; }
}
function wrap(object, names) {
  for (const name of names) {
    const fn = object[name];
    object[name] = fn.constructor.name === "AsyncFunction"
      ? async function (...args) { return run(() => fn.apply(this, args)); }
      : function (...args) { return run(() => fn.apply(this, args)); };
  }
  return object;
}
function close(id) {
  fs.mkdirSync(base(), { recursive: true });
  fs.writeFileSync(gateFile(), JSON.stringify({ id, pid: process.pid }), { flag: "wx", mode: 0o600 });
}
function open(id) {
  if (read(gateFile())?.id === id) fs.unlinkSync(gateFile());
}
function active() {
  if (!fs.existsSync(base())) return [];
  const result = [];
  for (const name of fs.readdirSync(base())) {
    if (!/^\d+-[a-f0-9-]+\.json$/.test(name)) continue;
    const file = path.join(base(), name);
    const op = read(file);
    if (!op) continue;
    if (alive(op.pid)) result.push(op);
    else fs.unlinkSync(file);
  }
  return result;
}
module.exports = { run, wrap, close, open, active, gateFile, read, alive };
