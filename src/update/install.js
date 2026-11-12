"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const config = require("../core/config");
const { root, atomic, read, releaseDir } = require("./common");
const release = require("./release");
const quote = (s) => "'" + s.replace(/'/g, "'\\''") + "'";

function bootstrap(base, version, dataDir, node = process.execPath) {
  const launcher = path.join(base, "launcher");
  fs.mkdirSync(path.join(launcher, "src/core"), { recursive: true });
  fs.mkdirSync(path.join(launcher, "bin"), { recursive: true });
  fs.mkdirSync(path.join(launcher, "assets"), { recursive: true });
  fs.cpSync(__dirname, path.join(launcher, "src/update"), { recursive: true });
  for (const name of ["config.js", "operations.js", "instance.js"]) fs.copyFileSync(path.join(__dirname, "../core", name), path.join(launcher, "src/core", name));
  fs.copyFileSync(path.join(__dirname, "../../assets/update-keys.json"), path.join(launcher, "assets/update-keys.json"));
  fs.copyFileSync(path.join(__dirname, "../../package.json"), path.join(launcher, "package.json"));
  const bin = path.join(launcher, "bin/dotjar.js");
  fs.writeFileSync(bin, '"use strict";\nprocess.env.DOTJAR_INSTALL_ROOT = require("path").resolve(__dirname, "../..");\nrequire("../src/update/launcher").main().catch(e => { console.error(e.message); process.exitCode = 1; });\n');
  atomic(path.join(base, "installation.json"), { protocol: 1, node, dataDir: path.resolve(dataDir), profile: require("../core/instance").profile(), verifyRoot: process.env.DOTJAR_VERIFY_ROOT || null });
  atomic(path.join(base, "current.json"), { version });
  atomic(path.join(base, "previous.json"), { version });
  return bin;
}
async function install(options = {}) {
  const instance = require("../core/instance");
  instance.assertInstall();
  const entry = path.join(path.resolve(options.entryDir || path.join(os.homedir(), ".local/bin")), "dotjar");
  if (instance.profile() === "verify") {
    const boundary = process.env.DOTJAR_VERIFY_ROOT;
    if (!boundary || ![entry, root(), config.dataDir()].every(p => instance.inside(p, boundary))) throw new Error("验收安装的程序、数据和命令入口必须在验收目录中");
  }
  if (fs.existsSync(entry)) throw new Error(`命令入口已存在：${entry}，未覆盖`);
  if (process.platform !== "darwin") throw new Error("托管安装首版支持 macOS");
  const service = require("../service");
  if (service.installed() || await service.running()) throw new Error("首次迁移请先停止旧版：登录自启用 dotjar service uninstall，否则用 dotjar stop；数据会保留，然后重新运行 install-managed");
  const base = root();
  if (fs.existsSync(base)) throw new Error(`托管安装目录已存在：${base}。请使用其中的启动器更新，避免覆盖现有安装。`);
  const keys = read(path.resolve(__dirname, "../../assets/update-keys.json"), {});
  if (!Object.keys(keys).length) throw new Error("发布签名尚未配置，请等待首个正式更新包");
  const envelope = await release.latest(keys, fetch, options.version);
  const manifest = release.verify(envelope, keys);
  const bytes = await release.download(manifest.artifact.url, release.MAX_PACKAGE);
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const stage = path.join(base, "staging", crypto.randomUUID());
  fs.mkdirSync(path.dirname(stage), { recursive: true });
  release.unpack(bytes, manifest, stage);
  const target = releaseDir(base, manifest.version);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(stage, target);
  const bin = bootstrap(base, manifest.version, config.dataDir());
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  // Never overwrite a different command without the owner resolving it.
  const script = `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(bin)} "$@"\n`;
  if (fs.existsSync(entry)) throw new Error(`安装已准备好，但 ${entry} 已存在，未覆盖。请使用 node ${bin} 启动。`);
  fs.writeFileSync(entry, script, { flag: "wx", mode: 0o755 });
  const savedPort = read(path.join(config.dataDir(), "install.json"), {}).port || 4747;
  const started = spawnSync(process.execPath, [bin, "web", "--no-open", "--port", String(savedPort)], { encoding: "utf8", timeout: 20000, env: process.env });
  if (started.status !== 0) throw new Error(`程序已安装，启动失败：${started.stderr || started.error?.message || "请查看 web.log"}`);
  return { entry, version: manifest.version, output: started.stdout };
}
module.exports = { install, bootstrap };
