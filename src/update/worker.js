"use strict";
const fs = require("fs");
const path = require("path");
const config = require("../core/config");
const operations = require("../core/operations");
const { root, read, atomic, releaseDir, newer } = require("./common");
const release = require("./release");
const { activate, recover, waitFor } = require("./transaction");

function sameFiles(a, b) {
  const left = fs.readdirSync(a).sort(), right = fs.readdirSync(b).sort();
  if (JSON.stringify(left) !== JSON.stringify(right)) return false;
  return left.every((name) => {
    const x = path.join(a, name), y = path.join(b, name);
    const xs = fs.lstatSync(x), ys = fs.lstatSync(y);
    if (xs.isSymbolicLink() || ys.isSymbolicLink()) return false;
    if (xs.isDirectory() && ys.isDirectory()) return sameFiles(x, y);
    return xs.isFile() && ys.isFile() && fs.readFileSync(x).equals(fs.readFileSync(y));
  });
}
async function worker(id, version) {
  const base = root();
  const lockFile = path.join(base, "job-lock.json");
  const lock = read(lockFile);
  if (lock && operations.alive(lock.pid)) throw new Error("已有更新在进行");
  if (lock) fs.unlinkSync(lockFile);
  fs.writeFileSync(lockFile, JSON.stringify({ id, pid: process.pid }), { flag: "wx", mode: 0o600 });
  let tx;
  try {
    recover(base);
    const previous = read(path.join(base, "current.json"));
    const envelope = read(path.join(config.dataDir(), "update-state.json"), {}).envelope;
    const keys = read(path.join(base, "launcher/assets/update-keys.json"), {});
    const m = release.verify(envelope, keys);
    if (m.version !== version || !newer(version, previous.version)) throw new Error("没有可安装的新版本");
    const pid = read(path.join(config.dataDir(), "web.pid"));
    if (!pid || !operations.alive(pid.pid)) throw new Error("请先启动托管版网页服务");
    const token = fs.readFileSync(path.join(config.dataDir(), "web-token"), "utf8").trim();
    const call = async (method, args = []) => {
      const res = await fetch(`http://127.0.0.1:${pid.port}/api/${method}`, { method: "POST", headers: { "content-type": "application/json", "x-dotjar": "1", cookie: `dotjar_token=${token}` }, body: JSON.stringify({ args }), signal: AbortSignal.timeout(3000) });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || "服务未响应");
      return body.value;
    };
    const initial = await call("updateHealth");
    if (initial.root !== base || initial.version !== previous.version || initial.dataDir !== config.dataDir()) throw new Error("当前服务不属于这个托管安装，不能替换");
    tx = { id, pid: process.pid, previous, next: { version }, port: pid.port, dataDir: config.dataDir(), phase: "downloading", startedAt: new Date().toISOString() };
    atomic(path.join(base, "transaction.json"), tx);
    const stage = path.join(base, "staging", id);
    fs.mkdirSync(path.dirname(stage), { recursive: true });
    release.unpack(await release.download(m.artifact.url, release.MAX_PACKAGE), m, stage);
    const target = releaseDir(base, version);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // A previous verified download may exist after an interrupted attempt.
    // Never replace a version directory while it could be running.
    if (fs.existsSync(target)) {
      if (!sameFiles(stage, target)) throw new Error("已有目标版本与签名包不一致，未覆盖；请检查安装目录");
      fs.rmSync(stage, { recursive: true });
    } else fs.renameSync(stage, target);
    await activate(base, tx, {
      async quiesce(jobId) {
        await waitFor(async () => (await call("updateReady")).ready, 30 * 60 * 1000, 1000);
        operations.close(jobId);
        await waitFor(() => operations.active().length === 0, 30 * 60 * 1000, 500);
        // A rest may have begun immediately before closing admission.
        const ready = await call("updateReady");
        if (!ready.ready) throw new Error("休息刚刚开始，请休息结束后重新更新");
      },
      async backup(jobId) {
        const destination = path.join(base, "updates", jobId, "backup");
        fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
        // Notes and library output are intentionally outside rollback scope.
        for (const name of ["config.json", "days", "inbox", "rest.json", "web-token"]) {
          const from = path.join(config.dataDir(), name);
          if (fs.existsSync(from)) fs.cpSync(from, path.join(destination, name), { recursive: true, dereference: false, filter: (p) => !fs.lstatSync(p).isSymbolicLink() });
        }
      },
      async restart(jobId) {
        // The stable supervisor starts the pointer's release after the child
        // exits. If a broken candidate already died it will retry on its own.
        await call("updateStop", [jobId]).catch(() => {});
      },
      async healthy(wanted) {
        await waitFor(async () => {
          try {
            const health = await call("updateHealth");
            if (health.version !== wanted || health.root !== base || health.dataDir !== config.dataDir() || health.schema !== 1) return false;
            const asset = await fetch(`http://127.0.0.1:${pid.port}/overlay.js`, { headers: { cookie: `dotjar_token=${token}` }, signal: AbortSignal.timeout(3000) });
            return asset.ok && (await asset.text()).includes("DotjarWords");
          } catch { return false; }
        }, 30000);
      },
      unlock: operations.open,
    });
  } catch (err) {
    const current = read(path.join(base, "transaction.json"));
    if (tx && current?.id === id && !["failed", "rolled-back", "recovery-needed"].includes(current.phase)) atomic(path.join(base, "transaction.json"), { ...current, phase: "failed", error: err.message });
    throw err;
  } finally {
    if (read(lockFile)?.id === id) fs.unlinkSync(lockFile);
  }
}
if (require.main === module) worker(process.argv[2], process.argv[3]).catch((err) => { console.error(err.message); process.exitCode = 1; });
module.exports = { worker, sameFiles };
