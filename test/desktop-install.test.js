"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const zlib = require("zlib");
const { installOffline, existing } = require("../src/update/desktop");
const { atomic, read } = require("../src/update/common");

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-desktop-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = path.join(dir, "managed"), dataDir = path.join(dir, "data"), payload = path.join(dir, "payload"), node = path.join(dir, "node");
  fs.mkdirSync(dataDir); fs.mkdirSync(payload); fs.writeFileSync(node, "runtime fixture");
  fs.writeFileSync(path.join(dataDir, "note.md"), "keep this note");
  fs.writeFileSync(path.join(payload, "NODE-LICENSE"), "runtime license");
  const files = [
    { path: "package.json", data: Buffer.from('{"name":"dotjar","version":"0.4.1"}').toString("base64") },
    ...["bin/dotjar.js", "src/server.js", "src/overlay/overlay.html"].map(p => ({ path: p, data: Buffer.from("fixture").toString("base64") })),
  ];
  const bytes = zlib.gzipSync(Buffer.from(JSON.stringify({ format: 1, files })));
  const artifact = { name: "dotjar-0.4.1.json.gz", size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), url: "https://github.com/yx0716/dotjar/releases/download/v0.4.1/dotjar-0.4.1.json.gz" };
  // Unit-test the transaction on any host; distributed artifacts remain macOS-only.
  const manifest = { version: "0.4.1", protocol: 1, launcher: 1, schema: 1, nodeMajor: 20, targets: [`${process.platform}-${process.arch}`], notes: "test", artifact };
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const envelope = { manifest, keyId: "test", signature: crypto.sign(null, Buffer.from(JSON.stringify(manifest)), privateKey).toString("base64") };
  atomic(path.join(payload, "dotjar-update.json"), envelope);
  fs.writeFileSync(path.join(payload, artifact.name), bytes);
  return { base, dataDir, payload, node, keys: { test: publicKey } };
}

test("offline installation verifies the release and puts runtime and launcher in stable paths", t => {
  const input = setup(t), result = installOffline(input);
  assert.equal(result.fresh, true);
  assert.equal(fs.readFileSync(result.node, "utf8"), "runtime fixture");
  assert.ok(result.node.startsWith(input.base + path.sep));
  assert.equal(fs.statSync(result.node).mode & 0o777, 0o755);
  assert.equal(read(path.join(input.base, "installation.json")).node, result.node);
  assert.equal(read(path.join(input.base, "current.json")).version, "0.4.1");
  assert.equal(fs.readFileSync(path.join(input.dataDir, "note.md"), "utf8"), "keep this note");
  fs.unlinkSync(input.node);
  assert.equal(fs.readFileSync(result.node, "utf8"), "runtime fixture", "runtime survives removal of app copy");
});

test("opening an existing managed installation preserves its version, runtime, and data location", t => {
  const input = setup(t), first = installOffline(input);
  fs.cpSync(path.join(input.base, "releases/0.4.1"), path.join(input.base, "releases/0.5.0"), { recursive: true });
  atomic(path.join(input.base, "current.json"), { version: "0.5.0" });
  const before = fs.readFileSync(path.join(input.base, "installation.json"), "utf8");
  const second = installOffline({ ...input, dataDir: "/unused", payload: "/missing", node: "/missing" });
  assert.equal(second.fresh, false);
  assert.equal(second.node, first.node);
  assert.equal(second.dataDir, input.dataDir);
  assert.equal(read(path.join(input.base, "current.json")).version, "0.5.0");
  assert.equal(fs.readFileSync(path.join(input.base, "installation.json"), "utf8"), before);
});

test("tampering or interrupted preparation leaves no partial install and can be retried", t => {
  const input = setup(t);
  const artifact = path.join(input.payload, "dotjar-0.4.1.json.gz");
  const original = fs.readFileSync(artifact);
  fs.appendFileSync(artifact, "tampered");
  assert.throws(() => installOffline(input), /校验/);
  assert.equal(fs.existsSync(input.base), false);
  assert.equal(fs.existsSync(input.base + ".install-lock"), false);
  fs.writeFileSync(artifact, original);
  assert.throws(() => installOffline({ ...input, node: "/missing-runtime" }), /ENOENT/);
  assert.equal(fs.existsSync(input.base), false);
  atomic(input.base + ".install-lock", { pid: 99999999 });
  assert.equal(installOffline(input).fresh, true);
  assert.equal(fs.readFileSync(path.join(input.dataDir, "note.md"), "utf8"), "keep this note");
});

test("live installers and updates block initialization without changing existing data", t => {
  const input = setup(t);
  atomic(input.base + ".install-lock", { pid: process.pid });
  assert.throws(() => installOffline(input), /另一个/);
  fs.unlinkSync(input.base + ".install-lock");
  installOffline(input);
  atomic(path.join(input.dataDir, "operations/update.json"), { pid: process.pid });
  assert.throws(() => existing(input.base), /正在更新/);
  assert.equal(fs.readFileSync(path.join(input.dataDir, "note.md"), "utf8"), "keep this note");
});

test("an incomplete existing install is never overwritten", t => {
  const input = setup(t);
  fs.mkdirSync(input.base);
  fs.writeFileSync(path.join(input.base, "keep"), "original");
  assert.throws(() => installOffline(input), /不完整/);
  assert.equal(fs.readFileSync(path.join(input.base, "keep"), "utf8"), "original");
});
