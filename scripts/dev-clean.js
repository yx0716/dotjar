#!/usr/bin/env node
"use strict";
// Development data left behind by worktrees that no longer exist. Each
// `npm run dev` keeps its state in ~/.dotjar-dev/<ID>/ and records the source
// it ran from; once that source is gone, nothing will ever open it again.
// Lists by default; --yes moves what can go to the Trash.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { moveToTrash } = require("../src/core/trash");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

const STATES = {
  stale: "源码已不存在，可清理",
  "in-use": "源码还在，保留",
  running: "正在运行，保留",
  "unknown-source": "没有来源记录，保留",
  "not-dev": "不是开发数据，保留",
};

function scan(devRoot) {
  let names;
  try {
    names = fs.readdirSync(devRoot);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return names.filter((name) => /^[a-f0-9]{12}$/.test(name)).sort().map((id) => {
    const dir = path.join(devRoot, id);
    const record = readJson(path.join(dir, "install.json"));
    const source = record?.instance?.source || (record?.bin ? path.resolve(record.bin, "../..") : null);
    const notes = (() => {
      try { return fs.readdirSync(path.join(dir, "deposits")).filter((f) => /\.(md|markdown)$/i.test(f)).length; } catch { return 0; }
    })();
    let state;
    if (readJson(path.join(dir, "instance.json"))?.profile !== "dev") state = "not-dev";
    else if (alive(readJson(path.join(dir, "web.pid"))?.pid)) state = "running";
    else if (!source) state = "unknown-source";
    else if (fs.existsSync(path.join(source, ".git"))) state = "in-use";
    else state = "stale";
    return { id, dir, source, state, notes };
  });
}

function main(args = process.argv.slice(2), devRoot = path.join(os.homedir(), ".dotjar-dev"), trash = moveToTrash, log = console.log) {
  if (args.some((a) => a !== "--yes")) throw new Error("用法：npm run dev:clean [-- --yes]");
  const entries = scan(devRoot);
  if (!entries.length) {
    log(`${devRoot} 下没有开发数据。`);
    return [];
  }
  for (const e of entries) log(`${e.id}  ${STATES[e.state]}${e.notes ? `（含 ${e.notes} 篇笔记）` : ""}\n    ${e.source || "来源未知"}`);
  const stale = entries.filter((e) => e.state === "stale");
  if (!stale.length) {
    log("没有需要清理的开发数据。");
    return [];
  }
  if (!args.includes("--yes")) {
    log(`可以清理 ${stale.length} 个。确认后运行：npm run dev:clean -- --yes（移到废纸篓）`);
    return [];
  }
  for (const e of stale) {
    trash(e.dir);
    log(`已移到废纸篓：${e.dir}`);
  }
  return stale;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
module.exports = { scan, main };
