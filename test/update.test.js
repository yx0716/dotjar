"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { spawn, spawnSync } = require("child_process");
const { verify, unpack, download } = require("../src/update/release");
const { activate, recover, waitFor } = require("../src/update/transaction");
const { atomic, read, newer, REPO } = require("../src/update/common");
const ops = require("../src/core/operations");
const { bootstrap } = require("../src/update/install");
const net = require("../src/update/net");
const http = require("http");
const https = require("https");
const source = path.resolve(__dirname, "..");
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-update-test-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function fixture(extra = []) {
  const files = [
    { path: "package.json", data: Buffer.from('{"name":"dotjar","version":"0.4.1"}').toString("base64") },
    ...["bin/dotjar.js", "src/server.js", "src/overlay/overlay.html"].map((p) => ({ path: p, data: Buffer.from("fixture").toString("base64") })), ...extra,
  ];
  const bytes = zlib.gzipSync(Buffer.from(JSON.stringify({ format: 1, files })));
  const manifest = { version: "0.4.1", protocol: 1, launcher: 1, schema: 1, nodeMajor: 20, targets: ["darwin-arm64", "darwin-x64"], notes: "A test release", artifact: { name: "dotjar-0.4.1.json.gz", size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), url: `https://github.com/${REPO}/releases/download/v0.4.1/dotjar-0.4.1.json.gz` } };
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const sign = (m) => ({ manifest: m, keyId: "test", signature: crypto.sign(null, Buffer.from(JSON.stringify(m)), privateKey).toString("base64") });
  return { bytes, manifest, sign, keys: { test: publicKey } };
}
test("release signature, compatibility, bytes and extraction paths are verified before activation", (t) => {
  const dir = temp(t), f = fixture();
  assert.equal(verify(f.sign(f.manifest), f.keys, "darwin", "arm64").version, "0.4.1");
  assert.throws(() => verify({ ...f.sign(f.manifest), manifest: { ...f.manifest, notes: "tampered" } }, f.keys), /签名/);
  assert.throws(() => verify(f.sign({ ...f.manifest, schema: 2 }), f.keys), /不兼容/);
  assert.throws(() => verify(f.sign(f.manifest), {}, "darwin", "arm64"), /签名/);
  assert.throws(() => verify(f.sign(f.manifest), f.keys, "win32", "x64"), /平台/);
  unpack(f.bytes, f.manifest, path.join(dir, "valid"));
  assert.equal(read(path.join(dir, "valid/package.json")).version, "0.4.1");
  assert.throws(() => unpack(Buffer.from("bad"), f.manifest, path.join(dir, "bad")), /校验/);
  for (const name of ["src/../../escape", "/tmp/escape", "src/../escape", "src/overlay/overlay.html", "src/Overlay/overlay.html"]) {
    const bad = fixture([{ path: name, data: "YQ==" }]);
    assert.throws(() => unpack(bad.bytes, bad.manifest, path.join(dir, crypto.randomUUID())), /非法|重复/);
  }
  assert.equal(newer("0.10.0", "0.9.0"), true);
  assert.equal(newer("0.4.0", "0.4.1"), false);
});
test("downloads reject private redirects, HTTP errors, and oversized responses", async () => {
  await download("https://api.github.com/repos/yx0716/dotjar/releases/latest", 20, async (_url, options) => {
    assert.equal(options.headers.Accept, "application/vnd.github+json");
    return new Response("{}");
  }, () => null);
  await assert.rejects(download("https://github.com/x", 10, async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } }), () => null), /不受信任/);
  await assert.rejects(download("https://github.com/x", 10, async () => new Response("404", { status: 404 }), () => null), /正式更新包/);
  await assert.rejects(download("https://github.com/x", 3, async () => new Response("too large"), () => null), /大小限制/);
});
const direct = () => null;
async function listen(t, server) {
  const sockets = new Set();
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  server.on("secureConnection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => { for (const s of sockets) s.destroy(); server.close(); });
  return server.address().port;
}
// A CONNECT proxy that forwards every tunnel to `origin` (a local stand-in for
// GitHub), or answers `refuse` without tunnelling.
async function fakeProxy(t, { origin, refuse } = {}) {
  const seen = [], proxy = http.createServer((req, res) => { res.writeHead(405); res.end(); });
  proxy.on("connect", (req, client, head) => {
    seen.push({ target: req.url, auth: req.headers["proxy-authorization"] || "" });
    client.on("error", () => {});
    if (refuse || !origin) { client.end(`HTTP/1.1 ${refuse || 502} No\r\n\r\n`); return; }
    const upstream = require("net").connect(origin, "127.0.0.1", () => { client.write("HTTP/1.1 200 Connection Established\r\n\r\n"); upstream.write(head); upstream.pipe(client); client.pipe(upstream); });
    upstream.on("error", () => client.destroy()); client.on("close", () => upstream.destroy());
  });
  return { port: await listen(t, proxy), seen };
}
function certificate(t) {
  const dir = temp(t), key = path.join(dir, "key.pem"), cert = path.join(dir, "cert.pem");
  const made = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "2", "-subj", "/CN=github.com", "-addext", "subjectAltName=DNS:github.com,DNS:objects.githubusercontent.com"], { encoding: "utf8" });
  return made.status === 0 ? { key: fs.readFileSync(key), cert: fs.readFileSync(cert) } : null;
}
test("release downloads use https_proxy/HTTPS_PROXY, then the macOS system proxy, and honour NO_PROXY", () => {
  const system = () => ({ url: "http://127.0.0.1:7897", exceptions: ["*.local", "<local>", "api.github.com"] });
  const pick = (env, sys = direct, url = "https://github.com/") => { const p = net.proxyFor(new URL(url), env, sys); return p && `${p.url.host} ${p.source}`; };
  assert.equal(pick({}), null);
  assert.equal(pick({ HTTPS_PROXY: "http://127.0.0.1:7890" }), "127.0.0.1:7890 HTTPS_PROXY");
  assert.equal(pick({ https_proxy: "127.0.0.1:7891", HTTPS_PROXY: "http://127.0.0.1:7890" }), "127.0.0.1:7891 https_proxy");
  assert.equal(pick({ HTTP_PROXY: "http://127.0.0.1:7890" }), null);
  assert.equal(pick({}, system), "127.0.0.1:7897 macOS 系统代理");
  assert.equal(pick({ HTTPS_PROXY: "http://127.0.0.1:7890" }, system), "127.0.0.1:7890 HTTPS_PROXY");
  assert.equal(pick({}, system, "https://api.github.com/repos"), null);
  const proxied = { HTTPS_PROXY: "http://127.0.0.1:7890" };
  assert.equal(pick({ ...proxied, NO_PROXY: "localhost, github.com" }, direct, "https://api.github.com/x"), null);
  assert.equal(pick({ ...proxied, no_proxy: "*.githubusercontent.com" }, direct, "https://objects.githubusercontent.com/x"), null);
  assert.equal(pick({ ...proxied, NO_PROXY: "github.com" }, direct, "https://objects.githubusercontent.com/x"), "127.0.0.1:7890 HTTPS_PROXY");
  assert.equal(pick({ ...proxied, NO_PROXY: "github.com:8443,10.0.0.0/8,.local" }), "127.0.0.1:7890 HTTPS_PROXY");
  assert.equal(pick({ NO_PROXY: "*" }, system), null);
  assert.throws(() => pick({ HTTPS_PROXY: "socks5://me:secret@127.0.0.1:7891" }), (e) => /socks5/.test(e.message) && !e.message.includes("secret"));
  const scutil = `<dictionary> {\n  ExceptionsList : <array> {\n    0 : 127.0.0.1\n    1 : *.local\n  }\n  HTTPEnable : 1\n  HTTPPort : 7897\n  HTTPProxy : 127.0.0.1\n  HTTPSEnable : 1\n  HTTPSPort : 7897\n  HTTPSProxy : 127.0.0.1\n  ProxyAutoConfigEnable : 0\n}\n`;
  assert.deepEqual(net.scutil(scutil), { url: "http://127.0.0.1:7897", exceptions: ["127.0.0.1", "*.local"] });
  assert.equal(net.scutil(scutil.replace("HTTPSEnable : 1", "HTTPSEnable : 0")), null);
  assert.equal(net.scutil(scutil.replace("HTTPSProxy : 127.0.0.1", "HTTPSProxy : ::1")).url, "http://[::1]:7897");
  assert.equal(net.scutil("<dictionary> {\n}"), null);
});
test("downloads tunnel through an HTTP proxy with end-to-end TLS and keep the redirect and size checks", async (t) => {
  const pair = certificate(t);
  if (!pair) return t.skip("openssl is not available to make a stand-in certificate");
  const origin = await listen(t, https.createServer(pair, (req, res) => {
    if (req.headers.host === "github.com" && req.url === "/yx0716/dotjar/releases/download/v1/asset") { res.writeHead(302, { location: "https://objects.githubusercontent.com/blob?sig=1" }); res.end(); }
    else if (req.headers.host === "objects.githubusercontent.com" && req.url === "/blob?sig=1") res.end("signed bytes");
    else if (req.url === "/stream") { res.write("x".repeat(50)); res.end("x".repeat(50)); }
    else if (req.url === "/private") { res.writeHead(302, { location: "http://127.0.0.1/secret" }); res.end(); }
    else { res.writeHead(404); res.end(); }
  }));
  const { port, seen } = await fakeProxy(t, { origin });
  const route = (u) => net.proxyFor(u, { HTTPS_PROXY: `http://dotjar:p%40ss@127.0.0.1:${port}` }, direct);
  const trusted = (u, init) => net.request(u, { ...init, ca: pair.cert });
  assert.equal((await download("https://github.com/yx0716/dotjar/releases/download/v1/asset", 1024, trusted, route)).toString(), "signed bytes");
  assert.deepEqual(seen.map((s) => s.target), ["github.com:443", "objects.githubusercontent.com:443"]);
  assert.equal(Buffer.from(seen[0].auth.replace(/^Basic /, ""), "base64").toString(), "dotjar:p@ss");
  await assert.rejects(download("https://github.com/stream", 60, trusted, route), /大小限制/);
  await assert.rejects(download("https://github.com/missing", 60, trusted, route), /正式更新包/);
  seen.length = 0;
  await assert.rejects(download("https://github.com/private", 60, trusted, route), /不受信任/);
  assert.deepEqual(seen.map((s) => s.target), ["github.com:443"]);
  // Without the stand-in's certificate the proxy cannot pose as GitHub. The
  // platform fetch, even passed explicitly, is swapped for the proxy route.
  const platform = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("platform fetch bypassed the proxy"); };
  try {
    await assert.rejects(download("https://github.com/yx0716/dotjar/releases/download/v1/asset", 1024, globalThis.fetch, route), (e) => /无法连接 github\.com（经代理 127\.0\.0\.1:\d+，来自 HTTPS_PROXY；[A-Z_]*(CERT|SIGNED)/.test(e.message));
  } finally { globalThis.fetch = platform; }
});
test("network failures name the host, the cause and the route instead of a bare fetch failed", async (t) => {
  const reset = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) });
  const plain = await download("https://github.com/x", 10, async () => { throw reset; }, direct).catch((e) => e);
  assert.match(plain.message, /^无法连接 github\.com（直连；ECONNRESET）/);
  assert.match(plain.message, /HTTPS_PROXY/);
  assert.equal(plain.cause, reset);
  const cut = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); c.error(Object.assign(new TypeError("terminated"), { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) })); } });
  assert.match((await download("https://objects.githubusercontent.com/x", 10, async () => new Response(cut), direct).catch((e) => e)).message, /objects\.githubusercontent\.com（直连；UND_ERR_SOCKET）/);
  const reservation = require("net").createServer();
  await new Promise((r) => reservation.listen(0, "127.0.0.1", r)); const closed = reservation.address().port; await new Promise((r) => reservation.close(r));
  const dead = await download("https://api.github.com/repos/x", 10, undefined, (u) => net.proxyFor(u, { https_proxy: `http://127.0.0.1:${closed}` }, direct)).catch((e) => e);
  assert.match(dead.message, new RegExp(`api\\.github\\.com（经代理 127\\.0\\.0\\.1:${closed}，来自 https_proxy；ECONNREFUSED）`));
  const { port } = await fakeProxy(t, { refuse: 407 });
  const refused = await download("https://github.com/x", 10, undefined, (u) => net.proxyFor(u, {}, () => ({ url: `http://127.0.0.1:${port}`, exceptions: [] }))).catch((e) => e);
  assert.match(refused.message, /来自 macOS 系统代理；代理拒绝转发，HTTP 407/);
});
test("a worker from an older launcher gets Node's own proxy switch while local calls stay direct", async (t) => {
  const system = () => ({ url: "http://127.0.0.1:7897", exceptions: [] });
  assert.deepEqual(net.workerEnv({}, direct), {});
  assert.deepEqual(net.workerEnv({ NO_PROXY: "*" }, system), {});
  assert.deepEqual(net.workerEnv({ HTTPS_PROXY: "socks5://127.0.0.1:1" }, system), {});
  const env = net.workerEnv({ no_proxy: "corp.example" }, system);
  assert.deepEqual(env, { https_proxy: "http://127.0.0.1:7897/", HTTPS_PROXY: "http://127.0.0.1:7897/", no_proxy: "corp.example,localhost,127.0.0.1,::1", NO_PROXY: "corp.example,localhost,127.0.0.1,::1", NODE_USE_ENV_PROXY: "1" });
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (!(major >= 24 || (major === 22 && minor >= 21))) return t.skip("this Node has no NODE_USE_ENV_PROXY");
  const { port, seen } = await fakeProxy(t, { refuse: 502 });
  const local = await listen(t, http.createServer((req, res) => res.end("local")));
  const script = `Promise.all([fetch("https://dotjar.invalid/").then(() => "reached", () => "stopped"), fetch("http://127.0.0.1:${local}/").then((r) => r.text())]).then((v) => console.log(JSON.stringify(v)))`;
  const child = spawn(process.execPath, ["-e", script], { env: { PATH: process.env.PATH, ...net.workerEnv({}, () => ({ url: `http://127.0.0.1:${port}`, exceptions: [] })) }, stdio: ["ignore", "pipe", "ignore"] });
  let out = ""; child.stdout.on("data", (b) => out += b);
  await new Promise((r) => child.once("exit", r));
  assert.deepEqual(JSON.parse(out), ["stopped", "local"]);
  assert.deepEqual(seen.map((s) => s.target), ["dotjar.invalid:443"]);
});
test("the update gate waits for existing work and excludes new CLI and nested writes", async (t) => {
  const dir = temp(t), before = process.env.DOTJAR_HOME;
  process.env.DOTJAR_HOME = dir; t.after(() => { if (before) process.env.DOTJAR_HOME = before; else delete process.env.DOTJAR_HOME; });
  let finish;
  const pending = ops.run(async () => { await new Promise((r) => { finish = r; }); return ops.run(() => "finished"); });
  ops.close("job");
  assert.equal(ops.active().length, 1);
  assert.throws(() => ops.run(() => {}), /更新/);
  const cmd = spawnSync(process.execPath, ["-e", 'require("./src/core/config").save({language:"en"})'], { cwd: source, env: process.env, encoding: "utf8" });
  assert.notEqual(cmd.status, 0); assert.match(cmd.stderr, /正在安装更新/);
  finish(); assert.equal(await pending, "finished"); assert.equal(ops.active().length, 0);
  ops.open("wrong-job"); assert.throws(() => ops.run(() => {}), /更新/);
  ops.open("job"); assert.equal(ops.run(() => 42), 42);
});
test("activation commits only after health checks; failures and interrupted switches restore the old pointer", async (t) => {
  const base = temp(t), data = path.join(base, "data"), before = process.env.DOTJAR_HOME;
  process.env.DOTJAR_HOME = data; t.after(() => { if (before) process.env.DOTJAR_HOME = before; else delete process.env.DOTJAR_HOME; });
  fs.mkdirSync(path.join(base, "releases/0.4.0/bin"), { recursive: true }); fs.writeFileSync(path.join(base, "releases/0.4.0/bin/dotjar.js"), "");
  const tx = { id: "tx", pid: process.pid, previous: { version: "0.4.0" }, next: { version: "0.4.1" } };
  atomic(path.join(base, "current.json"), tx.previous);
  const seen = [];
  const io = { quiesce: async (id) => ops.close(id), backup: async () => {}, restart: async () => {}, healthy: async (v) => { seen.push(v); }, unlock: ops.open };
  await activate(base, tx, io);
  assert.equal(read(path.join(base, "current.json")).version, "0.4.1");
  assert.equal(read(path.join(base, "transaction.json")).phase, "completed");
  await activate(base, tx, { ...io, healthy: async (v) => { if (v === "0.4.1") throw Error("broken candidate"); } });
  assert.equal(read(path.join(base, "current.json")).version, "0.4.0");
  assert.equal(read(path.join(base, "transaction.json")).phase, "rolled-back");
  for (const phase of ["waiting", "switching", "rolling-back", "recovery-needed"]) {
    atomic(path.join(base, "transaction.json"), { ...tx, pid: 99999999, phase });
    atomic(path.join(base, "current.json"), tx.next); ops.close(tx.id);
    recover(base);
    assert.equal(read(path.join(base, "current.json")).version, "0.4.0");
    assert.equal(read(path.join(base, "transaction.json")).phase, "recovered");
    assert.equal(fs.existsSync(ops.gateFile()), false);
  }
});
test("managed supervisor performs a real service switch and rolls back a crashing release on the same port and token", { timeout: 25000 }, async (t) => {
  const base = temp(t), data = path.join(base, "data"), before = process.env.DOTJAR_HOME;
  const previousRoot = process.env.DOTJAR_INSTALL_ROOT;
  process.env.DOTJAR_INSTALL_ROOT = base;
  process.env.DOTJAR_HOME = data;
  t.after(() => { if (before) process.env.DOTJAR_HOME = before; else delete process.env.DOTJAR_HOME; if (previousRoot) process.env.DOTJAR_INSTALL_ROOT = previousRoot; else delete process.env.DOTJAR_INSTALL_ROOT; });
  for (const version of ["0.4.0", "0.4.1", "0.4.2"]) {
    const target = path.join(base, "releases", version); fs.mkdirSync(target, { recursive: true });
    for (const name of ["src", "bin"]) fs.cpSync(path.join(source, name), path.join(target, name), { recursive: true, filter: (p) => !p.includes(`${path.sep}fonts`) });
    atomic(path.join(target, "package.json"), { name: "dotjar", version });
    fs.mkdirSync(path.join(target, "assets")); atomic(path.join(target, "assets/update-keys.json"), {});
  }
  fs.writeFileSync(path.join(base, "releases/0.4.2/bin/dotjar.js"), "process.exit(1);\n");
  const bin = bootstrap(base, "0.4.0", data);
  const signing = crypto.generateKeyPairSync("ed25519");
  const publicKey = signing.publicKey.export({ type: "spki", format: "pem" });
  const candidate = path.join(base, "candidate-source");
  fs.renameSync(path.join(base, "releases/0.4.1"), candidate);
  atomic(path.join(candidate, "assets/update-keys.json"), { test: publicKey });
  atomic(path.join(base, "launcher/assets/update-keys.json"), { test: publicKey });
  require("../scripts/release").build({ privateKey: signing.privateKey, out: path.join(base, "artifacts"), directory: candidate });
  const signed = read(path.join(base, "artifacts/dotjar-update.json"));
  atomic(path.join(data, "update-state.json"), { envelope: signed });
  const net = require("net"), reservation = net.createServer();
  await new Promise((r) => reservation.listen(0, "127.0.0.1", r)); const port = reservation.address().port; await new Promise((r) => reservation.close(r));
  atomic(path.join(data, "config.json"), { rest: { enabled: false }, claudeDir: path.join(data, "empty"), codexDir: path.join(data, "empty"), noteDirs: [] });
  fs.writeFileSync(path.join(data, "precious-note.md"), "Keep me");
  let output = "";
  const child = spawn(process.execPath, [bin, "web", "--foreground", "--no-open", "--port", String(port)], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (b) => output += b); child.stderr.on("data", (b) => output += b);
  t.after(async () => { child.kill("SIGTERM"); await new Promise((r) => { if (child.exitCode !== null) return r(); child.once("exit", r); }); });
  let token;
  const call = async (name, args = []) => {
    token ||= fs.readFileSync(path.join(data, "web-token"), "utf8").trim();
    const r = await fetch(`http://127.0.0.1:${port}/api/${name}`, { method: "POST", headers: { cookie: `dotjar_token=${token}`, "x-dotjar": "1", "content-type": "application/json" }, body: JSON.stringify({ args }), signal: AbortSignal.timeout(500) });
    const body = await r.json(); if (!body.ok) throw Error(body.error); return body.value;
  };
  await waitFor(async () => { try { return (await call("updateHealth")).version === "0.4.0"; } catch { return false; } }, 8000).catch((e) => { throw Error(e.message + output); });
  async function update(from, to) {
    const tx = { id: crypto.randomUUID(), pid: process.pid, previous: { version: from }, next: { version: to } };
    return activate(base, tx, {
      quiesce: async (id) => { ops.close(id); await waitFor(() => ops.active().length === 0); },
      backup: async () => {},
      restart: async (id) => { await call("updateStop", [id]).catch(() => {}); },
      healthy: async (v) => waitFor(async () => { try { return (await call("updateHealth")).version === v; } catch { return false; } }, v === "0.4.2" ? 1500 : 6000),
      unlock: ops.open,
    });
  }
  const downloader = require("../src/update/release"), realDownload = downloader.download;
  downloader.download = async (url) => { assert.equal(url, signed.manifest.artifact.url); return fs.readFileSync(path.join(base, "artifacts", signed.manifest.artifact.name)); };
  try { await require("../src/update/worker").worker(crypto.randomUUID(), "0.4.1"); }
  finally { downloader.download = realDownload; }
  assert.equal(read(path.join(base, "transaction.json")).phase, "completed");
  assert.equal((await call("updateHealth")).version, "0.4.1");
  assert.equal((await update("0.4.1", "0.4.2")).phase, "rolled-back");
  assert.equal((await call("updateHealth")).version, "0.4.1");
  assert.equal(fs.readFileSync(path.join(data, "web-token"), "utf8").trim(), token);
  assert.equal(fs.readFileSync(path.join(data, "precious-note.md"), "utf8"), "Keep me");
});

test("a pinned install fetches that release and verifies its signed version", async () => {
  const f = fixture();
  const requested = [];
  const { latest } = require("../src/update/release");
  const fetcher = async url => {
    requested.push(url);
    return new Response(JSON.stringify(url.includes("api.github.com") ? { tag_name: "v0.4.1", draft: false, prerelease: false } : f.sign(f.manifest)));
  };
  const envelope = await latest(f.keys, fetcher, "0.4.1");
  assert.equal(envelope.manifest.version, "0.4.1");
  assert.match(requested[0], /releases\/tags\/v0\.4\.1$/);
  await assert.rejects(latest(f.keys, fetcher, "0.4.2"), /目标版本/);
  await assert.rejects(latest(f.keys, fetcher, "latest"), /无效/);
});
