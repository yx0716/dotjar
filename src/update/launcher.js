"use strict";
// This file and its update modules live outside version directories. launchd
// supervises this process; it supervises only the selected release's web child.
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { root, read, releaseDir, sleep } = require("./common");
const { recover } = require("./transaction");
const operations = require("../core/operations");
async function main(args = process.argv.slice(2)) {
  const base = root();
  const install = read(path.join(base, "installation.json"));
  if (!install) throw new Error("托管安装记录缺失");
  process.env.DOTJAR_PROFILE = install.profile || "production";
  if (install.verifyRoot) process.env.DOTJAR_VERIFY_ROOT = install.verifyRoot;
  process.env.DOTJAR_HOME = install.dataDir;
  process.env.DOTJAR_INSTALL_ROOT = base;
  process.env.DOTJAR_MANAGED_ROOT = base;
  process.env.DOTJAR_LAUNCHER = path.join(base, "launcher/bin/dotjar.js");
  const supervise = args.includes("--foreground") && (args[0] === "web" || args[0]?.startsWith("--"));
  let child, stopping = false, recovering = false;
  const stop = () => { stopping = true; child?.kill("SIGTERM"); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
  while (!stopping) {
    recover(base);
    const pointer = read(path.join(base, "current.json"));
    const bin = path.join(releaseDir(base, pointer.version), "bin/dotjar.js");
    const code = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, [bin, ...args], { stdio: "inherit", env: process.env });
      const monitor = supervise ? setInterval(() => {
        try {
          const tx = read(path.join(base, "transaction.json"));
          if (!tx || operations.alive(tx.pid)) return;
          const unfinished = !["completed", "rolled-back", "failed", "recovered"].includes(tx.phase);
          recover(base);
          if (unfinished) { recovering = true; child.kill("SIGTERM"); }
        } catch (err) { console.error(err.message); }
      }, 1000) : null;
      child.once("error", (err) => { clearInterval(monitor); console.error(err.message); resolve(1); });
      child.once("exit", (exitCode) => { clearInterval(monitor); resolve(exitCode || 0); });
    });
    if (!supervise || stopping) { process.exitCode = code; break; }
    if (recovering) { recovering = false; continue; }
    const tx = read(path.join(base, "transaction.json"));
    if (!tx || !["switching", "rolling-back", "recovery-needed"].includes(tx.phase)) { process.exitCode = code; break; }
    await sleep(500);
  }
}
if (require.main === module) main().catch((err) => { console.error(err.message); process.exitCode = 1; });
module.exports = { main };
