#!/usr/bin/env node
"use strict";
const path = require("path");
const os = require("os");
const fs = require("fs");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const source = fs.realpathSync(path.resolve(__dirname, ".."));
const id = crypto.createHash("sha256").update(source).digest("hex").slice(0, 12);
const args = process.argv.slice(2);
if (args.some(a => !["--real-data", "--allow-model", "--no-open"].includes(a))) throw new Error("用法：npm run dev -- [--real-data] [--allow-model] [--no-open]");
if (args.includes("--allow-model") && !args.includes("--real-data")) throw new Error("--allow-model 必须同时指定 --real-data");
const env = { ...process.env };
for (const name of Object.keys(env)) if (/^(DOTJAR_|STRATA_)/.test(name)) delete env[name];
for (const name of ["NODE_OPTIONS", "NODE_PATH", "ELECTRON_RUN_AS_NODE"]) delete env[name];
Object.assign(env, { DOTJAR_PROFILE: "dev", DOTJAR_HOME: path.join(os.homedir(), ".dotjar-dev", id),
  DOTJAR_REAL_DATA: args.includes("--real-data") ? "1" : "0", DOTJAR_ALLOW_MODEL: args.includes("--allow-model") ? "1" : "0",
  DOTJAR_DEV_BRANCH: spawnSync("git", ["branch", "--show-current"], { cwd: source, encoding: "utf8" }).stdout?.trim() || "detached" });
// Update metadata and staging never point at the customer's managed installation.
env.DOTJAR_INSTALL_ROOT = path.join(env.DOTJAR_HOME, "program");
console.log(`开发版 · ${env.DOTJAR_DEV_BRANCH}\n源码：${source}\n数据：${env.DOTJAR_HOME}\n${args.includes("--real-data") ? "读取真实记录，笔记仍写入开发目录" : "演示数据，不读取真实对话"}；${args.includes("--allow-model") ? "已允许模型消耗" : "不调用模型"}\n按 Ctrl+C 停止。`);
const child = spawn(process.execPath, [path.join(source, "bin/dotjar.js"), "web", "--foreground", "--port", "0", ...(args.includes("--no-open") ? ["--no-open"] : [])], { env, stdio: "inherit" });
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("error", err => { console.error(err.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code || 0; });
