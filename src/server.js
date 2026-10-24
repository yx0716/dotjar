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
  "/demo-data.js": ["demo-data.js", "text/javascript; charset=utf-8"],
  "/web-bridge.js": ["web-bridge.js", "text/javascript; charset=utf-8"],
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

function createApi(session, options = {}) {
  return {
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
    distill: (days) => session.distill(days),
    calendar: (month) => session.calendar(month),
    distilling: () => session.isDistilling(),
    pulse: () => session.pulse(),
    setEngine: (id) => session.setEngine(id),
    keep: (id) => session.keep(id),
    skip: (id) => session.skip(id),
    reopen: (id) => session.reopen(id),
    capture: (text) => session.capture(text, "网页"),
    setDepositDir: (dir) => session.setDepositDir(dir),
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
  const session = options.session || createSession();
  const token = options.token || loadToken();
  let httpServer = null;
  const api = createApi(session, { restartable: options.restartable, restart: () => relaunch(httpServer) });

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
        return send(res, 403, "text/html; charset=utf-8", "<!doctype html><meta charset=utf-8><title>dotjar</title><p style=\"font:16px system-ui;margin:3em\">这个页面要从 dotjar 打开：在终端运行 <code>npm run web</code>。<br>Open this page from dotjar: run <code>npm run web</code> in a terminal.</p>");
      }

      if (req.method === "GET" || req.method === "HEAD") {
        if (url.pathname === "/") {
          const html = fs.readFileSync(path.join(OVERLAY, "overlay.html"), "utf8").replace("</head>", '  <link rel="icon" href="/icon.png" />\n  </head>');
          return send(res, 200, "text/html; charset=utf-8", html, { "x-dotjar": "1", "x-dotjar-code": String(LOADED) });
        }
        if (url.pathname === "/library") return send(res, 200, "text/html; charset=utf-8", fs.readFileSync(session.library()));
        if (url.pathname === "/icon.png") return send(res, 200, "image/png", fs.readFileSync(path.join(__dirname, "..", "assets", "icon.png")));
        const hit = STATIC[url.pathname];
        if (hit) return send(res, 200, hit[1], fs.readFileSync(path.join(OVERLAY, hit[0])));
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
    const server = createServer({ token, restartable: options.restartable });
    try {
      const bound = await listen(server, port);
      return { server, port: bound, url: `http://127.0.0.1:${bound}/?t=${token}`, reused: false };
    } catch (err) {
      if (err.code !== "EADDRINUSE") throw err;
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
