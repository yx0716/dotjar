"use strict";

const path = require("path");
const { spawn } = require("child_process");

// One native surface per rest. The server owns its lifetime; the child also
// has a deadline in case the server is killed without running cleanup.
function createRestWindow(options = {}) {
  const launch = options.spawn || spawn;
  const platform = options.platform || process.platform;
  let active = null;

  function close() {
    const current = active;
    active = null;
    if (!current) return;
    current.closed = true;
    clearTimeout(current.deadline);
    clearTimeout(current.loading);
    current.child.kill();
  }

  function show(url, status, fallback = () => {}) {
    if (active && active.startedAt === status.startedAt) return;
    close();
    if (platform !== "darwin") return fallback();
    const seconds = Math.max(10, Math.ceil((status.endsAt - Date.now()) / 1000) + 30 * 60);
    let child;
    try {
      child = launch("/usr/bin/osascript", ["-l", "JavaScript", path.join(__dirname, "rest-window.jxa"), "", String(seconds), options.corner ? "corner" : ""], {
        env: { ...process.env, DOTJAR_REST_URL: url },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      return fallback();
    }
    const current = { child, startedAt: status.startedAt, ready: false, closed: false };
    active = current;
    const fail = () => {
      if (current.closed) return;
      const retry = !current.ready;
      if (active === current) close();
      if (retry) fallback();
    };
    let output = "";
    child.stdout.on("data", (chunk) => {
      output = (output + chunk).slice(-128);
      if (output.includes("ready\n")) {
        current.ready = true;
        clearTimeout(current.loading);
      }
    });
    child.stderr.resume();
    child.once("error", fail);
    child.once("exit", fail);
    current.loading = setTimeout(fail, 12000);
    current.deadline = setTimeout(close, seconds * 1000);
    current.loading.unref();
    current.deadline.unref();
  }

  return {
    show,
    close,
    sync(status) {
      if (active && (status.phase !== "resting" || status.startedAt !== active.startedAt)) close();
    },
  };
}

module.exports = { createRestWindow };
