"use strict";

// The same interface as the desktop veil, served to a browser on this
// machine. Nothing here listens beyond 127.0.0.1, and every request has to
// carry the token that only someone who started the server can have.

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const config = require("./core/config");
const { createSession } = require("./core/session");
const { createRestWindow } = require("./rest-window");
const updates = require("./update/manager");
const operations = require("./core/operations");

const DEFAULT_PORT = 4747;
const COOKIE = "dotjar_token";
const BODY_LIMIT = 2 * 1024 * 1024;
const OVERLAY = path.join(__dirname, "overlay");

// When the code on disk last changed. The page is read from disk on every
// request, but everything behind it was loaded when the server started; a
// server older than its files hands out a page its own code cannot answer.
// Files only the browser or the desktop shell runs do not count: a change
// to those reaches the page without a restart, or never touches the server.
const NOT_SERVER_CODE = new Set(["overlay.js", "demo-data.js", "web-bridge.js", "main.js", "preload.js"]);

function codeStamp() {
  let newest = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".js") && !NOT_SERVER_CODE.has(entry.name)) newest = Math.max(newest, fs.statSync(file).mtimeMs);
    }
  };
  for (const dir of ["src", "bin"]) {
    try {
      walk(path.join(__dirname, "..", dir));
    } catch {
      // a folder missing from a trimmed install
    }
  }
  return Math.floor(newest);
}

const LOADED = codeStamp();

const STATIC = {
  "/overlay.css": ["overlay.css", "text/css; charset=utf-8"],
  "/overlay.js": ["overlay.js", "text/javascript; charset=utf-8"],
  "/markdown.js": ["markdown.js", "text/javascript; charset=utf-8"],
  "/words.js": ["words.js", "text/javascript; charset=utf-8"],
  "/growth.js": ["growth.js", "text/javascript; charset=utf-8"],
  "/usage.js": ["usage.js", "text/javascript; charset=utf-8"],
  "/updates.js": ["updates.js", "text/javascript; charset=utf-8"],
  "/demo-data.js": ["demo-data.js", "text/javascript; charset=utf-8"],
  "/web-bridge.js": ["web-bridge.js", "text/javascript; charset=utf-8"],
  "/fonts/huiwen-mincho-titles.woff": ["fonts/huiwen-mincho-titles.woff", "font/woff"],
  "/fonts/lxgw-wenkai-regular.woff": ["fonts/lxgw-wenkai-regular.woff", "font/woff"],
  "/fonts/lxgw-wenkai-medium.woff": ["fonts/lxgw-wenkai-medium.woff", "font/woff"],
};

function tokenPath() {
  return path.join(config.dataDir(), "web-token");
}

// One token per data folder, readable only by its owner.
function loadToken() {
  try {
    const existing = fs.readFileSync(tokenPath(), "utf8").trim();
    if (/^[0-9a-f]{32,}$/.test(existing)) return existing;
  } catch {
    // none yet
  }
  const token = crypto.randomBytes(24).toString("hex");
  fs.mkdirSync(path.dirname(tokenPath()), { recursive: true });
  fs.writeFileSync(tokenPath(), token + "\n", { mode: 0o600 });
  return token;
}

function sameToken(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function cookieOf(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i !== -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...extra,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error("请求太大"));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// A page that asked about the rest within this long is taken to be open.
// Generous, because a tab in the background is only let run once a minute.
const PAGE_SEEN_FOR = 100 * 1000;

function createApi(session, options = {}) {
  const page = options.page || { seenAt: 0, visible: false, notifies: false };
  const restAction = (name) => {
    const status = session.rest[name]();
    if (options.restChanged) options.restChanged(status, name === "start");
    return status;
  };
  return {
    updateStatus: () => updates.status(),
    updateCheck: () => updates.check(),
    updatePreferences: (patch) => updates.preferences(patch),
    updateInstall: (version) => updates.start(version),
    updateReady: () => ({ ready: !session.isDistilling() && session.rest.status().phase === "idle" }),
    updateHealth: () => {
      const os = require("os");
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-health-"));
      try { fs.writeFileSync(path.join(scratch, "probe"), "ok", { flag: "wx" }); }
      finally { fs.rmSync(scratch, { recursive: true, force: true }); }
      return { version: require("../package.json").version, root: process.env.DOTJAR_MANAGED_ROOT || null, dataDir: config.dataDir(), schema: 1 };
    },
    updateStop: (id) => {
      const gate = operations.read(operations.gateFile());
      if (!process.env.DOTJAR_MANAGED_ROOT || !gate || gate.id !== id || operations.active().length) throw new Error("更新尚未就绪");
      if (!options.updateStop) throw new Error("此服务不支持更新切换");
      setTimeout(options.updateStop, 100);
      return true;
    },
    meta: () => ({
      demo: false,
      web: true,
      // The files changed after this server started: the page offers a restart.
      stale: Boolean(options.restartable) && codeStamp() > LOADED,
      ...session.engine(),
      hotkey: "",
      captureHotkey: "",
      mac: process.platform === "darwin",
      wording: session.config.wording,
      // "auto" leaves the choice to the browser's own language.
      language: session.config.language,
    }),
    today: (back) => session.today(back),
    startDistill: (days) => session.startDistill(days),
    jobStatus: (id) => session.jobStatus(id),
    distill: (days) => session.distill(days),
    calendar: (month) => session.calendar(month),
    usage: (day) => session.usage(day),
    distilling: () => session.isDistilling(),
    pulse: () => session.pulse(),
    setEngine: (id) => session.setEngine(id),
    keep: (id) => session.keep(id),
    skip: (id) => session.skip(id),
    reopen: (id) => session.reopen(id),
    capture: (text) => session.capture(text, "网页"),
    setDepositDir: (dir) => session.setDepositDir(dir),
    // The page asks this every so often while it is open; the asking is also
    // how the server knows a page is there to show a rest when one falls due.
    rest: (beat) => {
      page.seenAt = Date.now();
      page.visible = Boolean(beat && beat.visible);
      page.notifies = Boolean(beat && beat.notifies);
      return session.rest.status();
    },
    restRecap: () => session.rest.recap(),
    restStart: () => restAction("start"),
    restSkip: () => restAction("skip"),
    restSnooze: () => restAction("snooze"),
    restDone: () => restAction("done"),
    setRest: (patch) => session.rest.set(patch),
    removeFromLibrary: (file) => session.removeFromLibrary(file),
    restoreToLibrary: (undo) => session.restoreToLibrary(undo),
    restart: () => {
      if (!options.restartable) throw new Error("这个服务不能从页面重启");
      if (session.isDistilling()) throw new Error("正在整理，整理完再重启");
      setTimeout(options.restart, 80); // answer first, then go
      return true;
    },
    reveal: (file) => {
      if (typeof file !== "string" || !path.isAbsolute(file) || !fs.existsSync(file)) return false;
      if (process.platform === "darwin") spawn("open", ["-R", file], { stdio: "ignore", detached: true }).unref();
      return true;
    },
  };
}

function createServer(options = {}) {
  // What is known of the page in the browser, for deciding who shows a rest.
  const page = { seenAt: 0, visible: false, notifies: false };
  let httpServer = null;
  const restWindow = options.restWindow || createRestWindow();
  const token = options.token || loadToken();
  const onRestDue = (status) => {
    const address = httpServer && httpServer.address();
    if (!address) return;
    const url = `http://127.0.0.1:${address.port}/?rest=1&t=${token}`;
    restWindow.show(`${url}&nativeRest=1`, status, () => {
      const open = Date.now() - page.seenAt < PAGE_SEEN_FOR;
      // On macOS even a visible tab may be covered by another app.
      if (process.platform !== "darwin" && open && (page.visible || page.notifies)) return;
      (options.openInBrowser || openInBrowser)(url);
    });
  };
  const session = options.session || createSession(options.watchRest ? { onRestDue } : {});
  const api = createApi(session, { restartable: options.restartable, restart: () => relaunch(httpServer), page,
    updateStop: () => {
      restWindow.close();
      httpServer.close(() => { require("./service").clearPid(); process.exit(0); });
      httpServer.closeAllConnections();
    },
    restChanged: (status, start) => {
      restWindow.sync(status);
      if (start && options.watchRest) onRestDue(status);
    },
  });

  httpServer = http.createServer(async (req, res) => {
    try {
      // A page on another site that points a hostname at 127.0.0.1 still
      // sends that hostname here; only loopback names are served.
      const host = String(req.headers.host || "");
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return send(res, 403, "text/plain; charset=utf-8", "forbidden");

      const url = new URL(req.url, `http://${host}`);
      const offered = url.searchParams.get("t");
      if (offered && sameToken(offered, token)) {
        // Trade the token in the address for a cookie, and clean the address.
        url.searchParams.delete("t");
        return send(res, 302, "text/plain", "", {
          location: url.pathname + url.search,
          "set-cookie": `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
        });
      }
      if (!sameToken(cookieOf(req, COOKIE), token)) {
        return send(res, 403, "text/html; charset=utf-8", "<!doctype html><meta charset=utf-8><title>dotjar</title><p style=\"font:16px system-ui;margin:3em\">这个页面要从 dotjar 打开：在终端再运行一次 dotjar，它会用带授权的地址打开这一页。<br>Open this page from dotjar: run dotjar again in a terminal and it opens this page with its token.</p>");
      }

      if (req.method === "GET" || req.method === "HEAD") {
        if (url.pathname === "/") {
          const html = fs.readFileSync(path.join(OVERLAY, "overlay.html"), "utf8").replace("</head>", '  <link rel="icon" href="/icon.png" />\n  </head>');
          return send(res, 200, "text/html; charset=utf-8", html, { "x-dotjar": "1", "x-dotjar-code": String(LOADED) });
        }
        if (url.pathname === "/library") return send(res, 200, "text/html; charset=utf-8", fs.readFileSync(session.library()));
        if (url.pathname === "/icon.png") return send(res, 200, "image/png", fs.readFileSync(path.join(__dirname, "..", "assets", "icon.png")));
        const hit = STATIC[url.pathname];
        // A font is megabytes and does not change between one look and the next: the browser may keep it for a day.
        if (hit) return send(res, 200, hit[1], fs.readFileSync(path.join(OVERLAY, hit[0])), hit[1] === "font/woff" ? { "cache-control": "private, max-age=86400" } : {});
        return send(res, 404, "text/plain; charset=utf-8", "not found");
      }

      if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        // A custom header cannot be sent cross-site without a preflight this
        // server never grants, so a form on another page cannot reach here.
        const origin = req.headers.origin;
        if (req.headers["x-dotjar"] !== "1" || (origin && origin !== `http://${host}`)) return send(res, 403, "application/json", JSON.stringify({ ok: false, error: "forbidden" }));
        const fn = api[url.pathname.slice(5)];
        if (!fn || !Object.prototype.hasOwnProperty.call(api, url.pathname.slice(5))) return send(res, 404, "application/json", JSON.stringify({ ok: false, error: "没有这个操作" }));
        let args = [];
        const raw = await readBody(req);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.args)) args = parsed.args;
        }
        try {
          return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, value: await fn(...args) }));
        } catch (err) {
          return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: (err && err.message) || String(err), code: err && err.code }));
        }
      }

      return send(res, 405, "text/plain; charset=utf-8", "method not allowed");
    } catch (err) {
      if (!res.headersSent) send(res, 400, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: (err && err.message) || String(err) }));
      else res.end();
    }
  });
  if (options.watchRest) {
    const stopUpdates = updates.watch();
    httpServer.once("close", stopUpdates);
  }
  // The server that stays running keeps the time between rests.
  if (options.watchRest && session.rest) httpServer.once("listening", () => {
    const shutdown = () => restWindow.close();
    process.on("exit", shutdown);
    const timer = setInterval(() => session.rest.tick().catch(() => {}), 30 * 1000);
    const guard = setInterval(() => restWindow.sync(session.rest.status()), 1000);
    timer.unref();
    guard.unref();
    httpServer.on("close", () => { clearInterval(timer); clearInterval(guard); process.removeListener("exit", shutdown); });
  });
  httpServer.on("close", () => restWindow.close());
  return httpServer;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", onError);
      resolve(server.address().port);
    });
  });
}

// Make way for a fresh copy of this server on the same port, so the page's
// address and its cookie keep working. Under launchd, launchd starts it.
function relaunch(httpServer) {
  const service = require("./service");
  if (service.installed()) {
    service.kickstart();
    return;
  }
  const port = httpServer.address().port;
  httpServer.close(() => {
    service.spawnServer(port);
    service.clearPid();
    process.exit(0);
  });
  httpServer.closeAllConnections();
}

// Is the thing already on this port a dotjar server for the same data folder?
// If so, when the code it runs last changed.
function isOurs(port, token) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/", headers: { cookie: `${COOKIE}=${token}` }, timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.headers["x-dotjar"] === "1" ? { code: Number(res.headers["x-dotjar-code"]) || 0 } : false);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function openInBrowser(url) {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
}

// Start serving, or find the copy that already is. Returns the address to
// open; `server` is null when an existing one was reused.
async function start(options = {}) {
  const token = loadToken();
  // Port 0 asks the system for any free port (used by the tests).
  const wanted = options.port === 0 ? 0 : Number(options.port) || DEFAULT_PORT;
  for (let port = wanted; port < wanted + 10; port++) {
    const server = createServer({ token, restartable: options.restartable, watchRest: options.watchRest });
    try {
      const bound = await listen(server, port);
      return { server, port: bound, url: `http://127.0.0.1:${bound}/?t=${token}`, reused: false };
    } catch (err) {
      if (err.code !== "EADDRINUSE" || process.env.DOTJAR_MANAGED_ROOT) throw err;
      if (await isOurs(port, token)) return { server: null, port, url: `http://127.0.0.1:${port}/?t=${token}`, reused: true };
    }
  }
  throw new Error(`${wanted} 到 ${wanted + 9} 的端口都被占用了，用 --port 指定一个`);
}

// A dotjar server for this data folder that is already listening, if any.
async function find(options = {}) {
  const token = loadToken();
  const wanted = Number(options.port) || DEFAULT_PORT;
  for (let port = wanted; port < wanted + (options.span || 10); port++) {
    const ours = await isOurs(port, token);
    if (ours) return { port, url: `http://127.0.0.1:${port}/?t=${token}`, code: ours.code };
  }
  return null;
}

module.exports = { DEFAULT_PORT, COOKIE, codeStamp, createServer, listen, loadToken, start, find, openInBrowser };
