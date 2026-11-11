"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { REPO, VERSION } = require("./common");
const MAX_PACKAGE = 64 * 1024 * 1024;
const MAX_UNPACKED = 160 * 1024 * 1024;
function allowedUrl(url) {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.username || u.password || u.port || !["api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(u.hostname)) throw new Error("更新下载地址不受信任");
  return u;
}
async function download(url, limit, fetcher = fetch) {
  for (let i = 0; i < 5; i++) {
    const address = allowedUrl(url);
    const response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(60000), headers: { "User-Agent": "dotjar-updater", Accept: address.hostname === "api.github.com" ? "application/vnd.github+json" : "application/octet-stream" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      url = new URL(response.headers.get("location"), url).href;
      continue;
    }
    if (!response.ok) throw new Error(response.status === 404 ? "还没有可用的正式更新包" : `更新服务返回 ${response.status}`);
    if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new Error("更新文件超过大小限制"); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) { throw new Error("更新文件超过大小限制"); }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new Error("更新下载重定向次数过多");
}
function verify(envelope, keys, platform = process.platform, arch = process.arch) {
  const m = envelope?.manifest;
  const key = keys[envelope?.keyId];
  if (!key || !crypto.verify(null, Buffer.from(JSON.stringify(m)), key, Buffer.from(envelope.signature || "", "base64"))) throw new Error("更新签名验证失败");
  if (!m || !VERSION.test(m.version) || m.protocol !== 1 || m.schema !== 1 || m.launcher !== 1 || m.nodeMajor !== 20) throw new Error("此更新与当前启动器或数据格式不兼容");
  if (Number(process.versions.node.split(".")[0]) < m.nodeMajor) throw new Error("请先安装 Node.js 20 或更新版本");
  if (!Array.isArray(m.targets) || !m.targets.includes(`${platform}-${arch}`)) throw new Error("此版本不支持当前平台");
  const a = m.artifact;
  if (!a || a.name !== `dotjar-${m.version}.json.gz` || !Number.isSafeInteger(a.size) || a.size <= 0 || a.size > MAX_PACKAGE || !/^[a-f0-9]{64}$/.test(a.sha256)) throw new Error("更新清单格式不正确");
  if (a.url !== `https://github.com/${REPO}/releases/download/v${m.version}/${a.name}`) throw new Error("更新制品来源不正确");
  if (typeof m.notes !== "string" || m.notes.length > 12000) throw new Error("更新说明格式不正确");
  return m;
}
async function latest(keys, fetcher = fetch, version) {
  if (version !== undefined && !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error("无效的目标版本号");
  const endpoint = version ? `tags/v${version}` : "latest";
  const info = JSON.parse((await download(`https://api.github.com/repos/${REPO}/releases/${endpoint}`, 1024 * 1024, fetcher)).toString());
  if (info.draft || info.prerelease || !/^v\d+\.\d+\.\d+$/.test(info.tag_name)) throw new Error("没有可用的稳定版本");
  const url = `https://github.com/${REPO}/releases/download/${info.tag_name}/dotjar-update.json`;
  const envelope = JSON.parse((await download(url, 128 * 1024, fetcher)).toString());
  const m = verify(envelope, keys);
  if (version && m.version !== version) throw new Error("目标版本与发布包不一致");
  if (`v${m.version}` !== info.tag_name) throw new Error("发布标签与签名版本不一致");
  return envelope;
}
function unpack(bytes, manifest, target) {
  if (bytes.length !== manifest.artifact.size || crypto.createHash("sha256").update(bytes).digest("hex") !== manifest.artifact.sha256) throw new Error("更新文件损坏，校验失败");
  const bundle = JSON.parse(zlib.gunzipSync(bytes, { maxOutputLength: MAX_UNPACKED }).toString());
  if (bundle.format !== 1 || !Array.isArray(bundle.files) || bundle.files.length > 4000) throw new Error("更新包格式不正确");
  const files = new Map(); let total = 0;
  for (const f of bundle.files) {
    if (typeof f.path !== "string" || !/^(bin|src|assets)\/[a-zA-Z0-9_./-]+$|^(package\.json|README(?:\.en)?\.md|LICENSE)$/.test(f.path) || f.path.split("/").some((s) => !s || s === "." || s === "..") || files.has(f.path.toLowerCase())) throw new Error("更新包包含非法或重复路径");
    if (typeof f.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.data)) throw new Error("更新文件编码错误");
    const data = Buffer.from(f.data, "base64"); total += data.length;
    if (total > MAX_UNPACKED) throw new Error("解包超过大小限制");
    files.set(f.path.toLowerCase(), { name: f.path, data });
  }
  const pkg = JSON.parse(files.get("package.json")?.data.toString() || "{}");
  if (pkg.name !== "dotjar" || pkg.version !== manifest.version || !files.has("bin/dotjar.js") || !files.has("src/server.js") || !files.has("src/overlay/overlay.html")) throw new Error("更新包缺少程序文件或版本不一致");
  // Caller provides a fresh directory. There are no archive links or executable
  // install hooks; every file is created exclusively under this directory.
  fs.mkdirSync(target, { recursive: false, mode: 0o700 });
  for (const { name, data } of files.values()) {
    const file = path.join(target, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data, { flag: "wx", mode: 0o644 });
  }
  return target;
}
module.exports = { MAX_PACKAGE, download, verify, latest, unpack, allowedUrl };
