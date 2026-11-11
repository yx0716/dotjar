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
  });
  await assert.rejects(download("https://github.com/x", 10, async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } })), /不受信任/);
  await assert.rejects(download("https://github.com/x", 10, async () => new Response("404", { status: 404 })), /正式更新包/);
  await assert.rejects(download("https://github.com/x", 3, async () => new Response("too large")), /大小限制/);
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
