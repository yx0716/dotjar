"use strict";
// Moving to the Trash, so that what a person clears can still be put back.
// macOS ships /usr/bin/trash from macOS 15; older systems are told to do it
// by hand instead of falling back to a permanent delete.
const fs = require("fs");
const { spawnSync } = require("child_process");

const TRASH = "/usr/bin/trash";

function available() {
  return process.platform === "darwin" && fs.existsSync(TRASH);
}

function moveToTrash(file, run = spawnSync) {
  if (!available()) throw new Error(`这台电脑不能从命令行移到废纸篓，请在访达中手动处理：${file}`);
  const res = run(TRASH, [file], { encoding: "utf8", timeout: 60000 });
  if (res.status !== 0 || fs.existsSync(file)) throw new Error(`移到废纸篓失败：${file} ${(res.stderr || res.error?.message || "").trim()}`);
}

module.exports = { available, moveToTrash };
