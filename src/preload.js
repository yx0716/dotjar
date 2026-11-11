"use strict";

const { contextBridge, ipcRenderer } = require("electron");

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (res && res.ok) return res.value;
  const err = new Error((res && res.error) || "出错了");
  err.code = res && res.code;
  throw err;
}

// Not `dotjar`: the page has an element with that id, and ids become window
// properties, which would shadow or be mistaken for the bridge.
contextBridge.exposeInMainWorld("dotjarBridge", {
  demo: process.argv.includes("--dotjar-demo"),
  meta: () => call("dotjar:meta"),
  updateStatus: () => call("dotjar:update-status"),
  updateCheck: () => call("dotjar:update-check"),
  updateInstall: (version) => call("dotjar:update-install", version),
  updatePreferences: (patch) => call("dotjar:update-preferences", patch),
  today: (daysBack) => call("dotjar:today", daysBack),
  distill: (days) => call("dotjar:distill", days),
  calendar: (month) => call("dotjar:calendar", month),
  distilling: () => call("dotjar:distilling"),
  setEngine: (id) => call("dotjar:set-engine", id),
  rest: (beat) => call("dotjar:rest", beat),
  restRecap: () => call("dotjar:rest-recap"),
  restStart: () => call("dotjar:rest-start"),
  restSkip: () => call("dotjar:rest-skip"),
  restSnooze: () => call("dotjar:rest-snooze"),
  restDone: () => call("dotjar:rest-done"),
  setRest: (patch) => call("dotjar:set-rest", patch),
  keep: (id) => call("dotjar:keep", id),
  skip: (id) => call("dotjar:skip", id),
  reopen: (id) => call("dotjar:reopen", id),
  copy: (text) => call("dotjar:copy", text),
  paste: () => call("dotjar:paste"),
  chooseDepositDir: () => call("dotjar:choose-deposit-dir"),
  reveal: (file) => call("dotjar:reveal", file),
  library: (anchor) => call("dotjar:library", anchor),
  hide: () => call("dotjar:hide"),
  onShown: (fn) => ipcRenderer.on("dotjar:shown", () => fn()),
  onCaptured: (fn) => ipcRenderer.on("dotjar:captured", () => fn()),
});
