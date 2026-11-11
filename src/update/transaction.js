"use strict";
const fs = require("fs");
const path = require("path");
const { read, atomic, releaseDir, sleep } = require("./common");
const operations = require("../core/operations");

// The transaction engine has injectable service boundaries so failure paths
// can be exercised without terminating a real user's service.
async function activate(base, tx, io) {
  const save = (phase, error) => {
    tx = { ...tx, phase, ...(error ? { error } : {}) };
    atomic(path.join(base, "transaction.json"), tx);
  };
  let switched = false;
  try {
    save("waiting");
    await io.quiesce(tx.id);
    await io.backup(tx.id);
    atomic(path.join(base, "previous.json"), tx.previous);
    save("switching"); // durable recovery record must precede the pointer
    atomic(path.join(base, "current.json"), tx.next);
    switched = true;
    await io.restart(tx.id);
    await io.healthy(tx.next.version);
    save("completed");
    io.unlock(tx.id);
  } catch (err) {
    if (!switched) {
      save("failed", err.message); io.unlock(tx.id); throw err;
    }
    atomic(path.join(base, "current.json"), tx.previous);
    save("rolling-back", err.message);
    try {
      await io.restart(tx.id);
      await io.healthy(tx.previous.version);
      save("rolled-back", err.message);
      io.unlock(tx.id);
    } catch (rollback) {
      // Keep admission closed. The stable launcher recovers after this worker
      // exits; no writes from an unhealthy candidate can be accepted.
      save("recovery-needed", `${err.message}; 回退启动失败：${rollback.message}`);
      throw rollback;
    }
  }
  return tx;
}
function recover(base) {
  const tx = read(path.join(base, "transaction.json"));
  if (!tx || operations.alive(tx.pid)) return;
  if (!["completed", "rolled-back", "failed", "recovered"].includes(tx.phase)) {
    if (!fs.existsSync(path.join(releaseDir(base, tx.previous.version), "bin/dotjar.js"))) throw new Error("上一版本缺失，请检查托管安装目录");
    atomic(path.join(base, "current.json"), tx.previous);
    atomic(path.join(base, "transaction.json"), { ...tx, phase: "recovered", error: "上次更新中断，已恢复上一版本" });
  }
  operations.open(tx.id);
}
async function waitFor(test, timeout = 30000, interval = 250) {
  const end = Date.now() + timeout;
  do { if (await test()) return; await sleep(interval); } while (Date.now() < end);
  throw new Error("等待服务就绪超时");
}
module.exports = { activate, recover, waitFor };
