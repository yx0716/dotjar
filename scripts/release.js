#!/usr/bin/env node
"use strict";
// Produces a signed, immutable release. Does not publish or run install hooks.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { REPO, VERSION, atomic } = require("../src/update/common");
const source = path.resolve(__dirname, "..");
function createKey(file = path.join(os.homedir(), ".dotjar-release/signing-key.pem")) {
  const keys = crypto.generateKeyPairSync("ed25519");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, keys.privateKey.export({ type: "pkcs8", format: "pem" }), { flag: "wx", mode: 0o600 });
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
  const keyId = crypto.createHash("sha256").update(publicKey).digest("hex").slice(0, 16);
  atomic(path.join(source, "assets/update-keys.json"), { [keyId]: publicKey });
  return { keyId, file };
}
function build({ privateKey, out, notes = "", directory = source }) {
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, "package.json")));
  if (!VERSION.test(pkg.version)) throw new Error("发布版本必须是稳定版 x.y.z");
  const publicKey = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  const keys = JSON.parse(fs.readFileSync(path.join(directory, "assets/update-keys.json")));
  const keyId = Object.keys(keys).find((id) => keys[id] === publicKey);
  if (!keyId) throw new Error("签名私钥与程序内置公钥不匹配");
  const files = [];
  function walk(relative) {
    const absolute = path.join(directory, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`发布包不能包含符号链接：${relative}`);
    if (stat.isDirectory()) for (const name of fs.readdirSync(absolute).sort()) walk(`${relative}/${name}`);
    else if (stat.isFile()) files.push({ path: relative, data: fs.readFileSync(absolute).toString("base64") });
  }
  for (const name of ["bin", "src", "assets", "package.json", "README.md", "README.en.md", "LICENSE"]) if (fs.existsSync(path.join(directory, name))) walk(name);
  const bytes = zlib.gzipSync(Buffer.from(JSON.stringify({ format: 1, files })), { level: 9 });
  const name = `dotjar-${pkg.version}.json.gz`;
  const manifest = { version: pkg.version, protocol: 1, launcher: 1, schema: 1, nodeMajor: 20, targets: ["darwin-arm64", "darwin-x64"], notes,
    artifact: { name, size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), url: `https://github.com/${REPO}/releases/download/v${pkg.version}/${name}` } };
  const signature = crypto.sign(null, Buffer.from(JSON.stringify(manifest)), privateKey).toString("base64");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, name), bytes);
  atomic(path.join(out, "dotjar-update.json"), { keyId, manifest, signature });
  return manifest;
}
if (require.main === module) {
  try {
    if (process.argv[2] === "keygen") console.log(createKey(process.argv[3]));
    else {
      const keyFile = process.env.DOTJAR_SIGNING_KEY_FILE;
      if (!keyFile) throw new Error("请设置 DOTJAR_SIGNING_KEY_FILE（私钥文件路径）");
      const notes = process.argv[2] ? fs.readFileSync(process.argv[2], "utf8") : "";
      console.log(build({ privateKey: fs.readFileSync(keyFile), out: path.join(source, "dist/release"), notes }));
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { createKey, build };
