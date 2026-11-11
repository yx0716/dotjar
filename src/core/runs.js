"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("./config");
const { alive, wrap } = require("./operations");
const root = () => path.join(config.dataDir(), "runs");
function write(record) {
  fs.mkdirSync(root(), { recursive: true, mode: 0o700 });
  const file = path.join(root(), `${record.id}.json`);
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(record), { flag: "wx", mode: 0o600 });
    fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
  return record;
}
function start(day, engine, model) {
  return write({ id: crypto.randomUUID(), day, engine, model: model || null,
    version: require("../../package.json").version, pid: process.pid, startedAt: Date.now(),
    endedAt: null, status: "running", usage: null, usageComplete: false, found: null });
}
function update(record, patch) { return write(Object.assign(record, patch)); }
function list(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) throw new Error("请选择有效日期");
  let files;
  try { files = fs.readdirSync(root()); } catch (e) { if (e.code === "ENOENT") return { records: [], total: 0, unreadable: 0 }; throw e; }
  const records = []; let unreadable = 0;
  for (const name of files) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    try {
      const r = JSON.parse(fs.readFileSync(path.join(root(), name), "utf8"));
      if (r.day !== day) continue;
      // Recover presentation after a crash without rewriting another process's files.
      if (r.status === "running" && (!Number.isInteger(r.pid) || r.pid <= 0 || !alive(r.pid))) r.status = "interrupted";
      delete r.pid;
      records.push(r);
    } catch { unreadable++; }
  }
  records.sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id));
  return { records: records.slice(0, 100), total: records.length, unreadable };
}
module.exports = { start, update, list };
wrap(module.exports, ["start", "update"]);
