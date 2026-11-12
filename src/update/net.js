"use strict";
// How signed-release downloads reach GitHub. The platform fetch ignores
// HTTPS_PROXY on Node 20, and on newer Nodes only honours it with
// NODE_USE_ENV_PROXY, which would also send the local service calls through
// the proxy. So the route is chosen here, per request: https_proxy /
// HTTPS_PROXY, then the macOS system proxy (launchd and Finder never see a
// shell's variables), else direct; NO_PROXY applies to both. Only HTTP(S)
// proxies are supported, through CONNECT: TLS stays end-to-end with the GitHub
// host, so a proxy can neither read nor alter a release.
const http = require("http");
const https = require("https");
const tls = require("tls");
const { spawnSync } = require("child_process");
const SYSTEM = "macOS 系统代理";
const LOCAL = "localhost,127.0.0.1,::1";

function bypassed(target, list) {
  const host = target.hostname.toLowerCase(), port = target.port || (target.protocol === "http:" ? "80" : "443");
  return String(list || "").split(/[\s,]+/).filter(Boolean).some((entry) => {
    if (entry === "*") return true;
    const [, name, only] = entry.toLowerCase().match(/^(.*?)(?::(\d+))?$/);
    const domain = name.replace(/^\*?\./, "");
    return (!only || only === port) && domain !== "" && (host === domain || host.endsWith(`.${domain}`));
  });
}
function parse(value, source) {
  let url;
  try { url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`); }
  catch { throw new Error(`${source} 不是有效的代理地址，应类似 http://127.0.0.1:7890`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${source} 是 ${url.protocol.slice(0, -1)} 代理；下载更新只支持 HTTP(S) 代理，例如 http://127.0.0.1:7890`);
  return { url, source };
}
// `scutil --proxy` prints the proxy the user (or their proxy app) switched on
// in System Settings. Only the HTTPS ("secure web") proxy applies; PAC is not
// evaluated.
function scutil(text) {
  const value = (key) => String(text).match(new RegExp(`^\\s*${key} : (.+)$`, "m"))?.[1].trim();
  const host = value("HTTPSProxy"), port = value("HTTPSPort");
  if (value("HTTPSEnable") !== "1" || !host || !/^\d+$/.test(port || "")) return null;
  const list = String(text).match(/ExceptionsList : <array> \{([^}]*)\}/)?.[1] || "";
  return { url: `http://${host.includes(":") ? `[${host}]` : host}:${port}`, exceptions: [...list.matchAll(/^\s*\d+ : (.+)$/gm)].map((m) => m[1].trim()) };
}
function systemProxy() {
  if (process.platform !== "darwin") return null;
  const out = spawnSync("/usr/sbin/scutil", ["--proxy"], { encoding: "utf8", timeout: 2000 });
  return out.status === 0 ? scutil(out.stdout) : null;
}
function proxyFor(target, env = process.env, system = systemProxy) {
  if (bypassed(target, env.no_proxy || env.NO_PROXY)) return null;
  for (const key of ["https_proxy", "HTTPS_PROXY"]) if (env[key]) return parse(env[key], key);
  const found = system();
  return found && !bypassed(target, found.exceptions.join(",")) ? parse(found.url, SYSTEM) : null;
}

function tunnel(target, via, signal) {
  return new Promise((resolve, reject) => {
    const headers = { host: `${target.hostname}:443` };
    if (via.username || via.password) headers["proxy-authorization"] = `Basic ${Buffer.from(`${decodeURIComponent(via.username)}:${decodeURIComponent(via.password)}`).toString("base64")}`;
    const secure = via.protocol === "https:";
    const req = (secure ? https : http).request({ host: via.hostname.replace(/^\[|\]$/g, ""), port: via.port || (secure ? 443 : 80), method: "CONNECT", path: `${target.hostname}:443`, headers, signal, agent: false });
    req.once("connect", (res, socket, head) => {
      if (res.statusCode < 200 || res.statusCode > 299) {
        socket.destroy();
        reject(Object.assign(new Error(`proxy refused CONNECT with HTTP ${res.statusCode}`), { code: "ERR_PROXY_TUNNEL", status: res.statusCode }));
        return;
      }
      if (head.length) socket.unshift(head);
      resolve(socket);
    });
    req.on("error", reject);
    req.end();
  });
}
// A fetch-shaped request. With `proxy` (from proxyFor) it tunnels; it never
// follows redirects, so the caller keeps checking every hop. `ca` exists for
// tests that stand in for GitHub with a local certificate.
async function request(url, init = {}) {
  const { proxy, ca, ...options } = init;
  if (!proxy) return fetch(url, options);
  const target = new URL(url);
  const raw = await tunnel(target, proxy.url, options.signal);
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ socket: raw, servername: target.hostname, ALPNProtocols: ["http/1.1"], ...(ca ? { ca } : {}) });
    socket.once("close", () => raw.destroy());
    socket.on("error", reject);
    raw.on("error", (err) => socket.destroy(err));
    const req = https.request({ host: target.hostname, port: 443, defaultPort: 443, path: target.pathname + target.search, method: "GET", headers: options.headers, signal: options.signal, createConnection: () => socket }, (res) => {
      try {
        const headers = new Headers();
        for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
        const empty = [204, 205, 304].includes(res.statusCode);
        if (empty) res.resume();
        resolve(new Response(empty ? null : stream(res), { status: res.statusCode, headers }));
      } catch (err) { res.destroy(); reject(err); }
    });
    req.on("error", (err) => { socket.destroy(); reject(err); });
    req.end();
  });
}
// Readable.toWeb on Node 20.11 throws an uncaught "Controller is already
// closed" when a body is cancelled (as redirects are), so adapt by hand.
function stream(res) {
  let done = false;
  const finish = (fn) => { if (!done) { done = true; fn(); } };
  return new ReadableStream({
    start(controller) {
      res.on("data", (chunk) => { if (done) return; controller.enqueue(chunk); if (controller.desiredSize <= 0) res.pause(); });
      res.once("end", () => finish(() => controller.close()));
      res.once("error", (err) => finish(() => controller.error(err)));
      res.once("close", () => finish(() => controller.error(Object.assign(new Error("connection closed before the download finished"), { code: "ECONNRESET" }))));
    },
    pull() { res.resume(); },
    cancel() { done = true; res.destroy(); },
  });
}

function reason(err, signal) {
  if (signal?.aborted && signal.reason?.name === "TimeoutError") return "超时";
  const chain = [];
  for (let e = err; e && chain.length < 6; e = e.cause) chain.push(e);
  if (chain.some((e) => e.name === "TimeoutError")) return "超时";
  const tunnelled = chain.find((e) => e.code === "ERR_PROXY_TUNNEL");
  if (tunnelled) return `代理拒绝转发，HTTP ${tunnelled.status}`;
  const coded = chain.find((e) => typeof e.code === "string" && e.code !== "ABORT_ERR") || chain.flatMap((e) => e.errors || []).find((e) => typeof e?.code === "string");
  return coded ? coded.code : chain.at(-1)?.message || "未知网络错误";
}
// Replace undici's bare "fetch failed" with the host, the underlying cause and
// what to change.
function failure(err, target, proxy, signal) {
  const why = reason(err, signal);
  const message = proxy
    ? `无法连接 ${target.hostname}（经代理 ${proxy.url.host}，来自 ${proxy.source}；${why}）。请确认代理软件正在运行、端口正确；不想走代理时可把 ${target.hostname} 加入 NO_PROXY。`
    : `无法连接 ${target.hostname}（直连；${why}）。如需代理才能访问 GitHub，请设置 HTTPS_PROXY（例如 http://127.0.0.1:7890），或在代理软件中开启系统代理后重试。`;
  return new Error(message, { cause: err });
}

// Launchers installed before this module existed download with the platform
// fetch. Hand their worker the same route through Node's own proxy switch
// (Node 22.21+ and 24+; older Nodes ignore it) while local service calls stay
// direct.
function workerEnv(env = process.env, system = systemProxy) {
  let proxy;
  try { proxy = proxyFor(new URL("https://github.com/"), env, system); } catch { return {}; }
  if (!proxy) return {};
  const skip = env.no_proxy || env.NO_PROXY;
  const local = skip ? `${skip},${LOCAL}` : LOCAL;
  return { https_proxy: proxy.url.href, HTTPS_PROXY: proxy.url.href, no_proxy: local, NO_PROXY: local, NODE_USE_ENV_PROXY: "1" };
}
module.exports = { proxyFor, systemProxy, scutil, request, failure, workerEnv };
