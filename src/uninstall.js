"use strict";

// Removing dotjar from this account. Program files go: the managed
// installation, its command entry, the login item and npx's cached copies.
// Records, settings and notes stay unless --purge, and even then the data
// folder only goes to the Trash. Notes kept outside it are never touched, and
// what needs an administrator (the app, the installer receipt) is only listed.
//
// Everything this needs is required up front: run from the managed entry, the
// code being executed lives inside the folder it removes.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const config = require("./core/config");
const instance = require("./core/instance");
const service = require("./service");
const { root } = require("./update/common");
const { moveToTrash } = require("./core/trash");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function defaults() {
  const home = os.homedir();
  return {
    base: root(),
    entryDir: path.join(home, ".local/bin"),
    npmCache: process.env.npm_config_cache || path.join(home, ".npm"),
    launchAgents: path.join(home, "Library/LaunchAgents"),
    app: "/Applications/dotjar.app",
    legacy: path.join(home, ".strata"),
    run: (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", timeout: 30000, ...opts }),
    trash: moveToTrash,
    uid: process.getuid?.(),
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function exists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

// "删除" + "npx 缓存" reads 删除 npx 缓存: a space between Chinese and Latin.
const act = (verb, what) => (/^[A-Za-z]/.test(what) ? `${verb} ${what}` : verb + what);
const same = (a, b) => instance.canonical(a) === instance.canonical(b);
const unquote = (s) => s.replace(/'\\''/g, "'");

// The command entry install-managed and the app write: a two-line sh script
// that runs a launcher. Anything else at that path belongs to someone else.
function entryLauncher(file) {
  if (fs.lstatSync(file).isSymbolicLink()) return null;
  const m = fs.readFileSync(file, "utf8").match(/^#!\/bin\/sh\nexec '((?:[^']|'\\'')*)' '((?:[^']|'\\'')*)' "\$@"\n$/);
  return m && /[/\\]launcher[/\\]bin[/\\]dotjar\.js$/.test(unquote(m[2])) ? unquote(m[2]) : null;
}

// npx keeps one folder per command line. Only folders made for dotjar alone.
function npxCopies(cache) {
  const dir = path.join(cache, "_npx");
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const found = [];
  for (const name of names) {
    const pkg = readJson(path.join(dir, name, "package.json"));
    const specs = pkg?._npx?.packages;
    if (Array.isArray(specs) && specs.length === 1 && Object.keys(pkg.dependencies || {}).join() === "dotjar") {
      found.push({ path: path.join(dir, name), spec: specs[0] });
    }
  }
  return found;
}

function countNotes(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => /\.(md|markdown)$/i.test(f)).length;
  } catch {
    return 0;
  }
}

// What uninstalling would do here, without changing anything.
function plan(options = {}) {
  const profile = instance.profile();
  if (profile === "dev") throw new Error("开发版不卸载客户程序；清理开发数据请用 npm run dev:clean");
  const o = { ...defaults(), ...options };
  const data = path.resolve(config.dataDir());
  const production = profile === "production";
  if (profile === "verify") {
    const boundary = process.env.DOTJAR_VERIFY_ROOT;
    if (!boundary || ![data, o.base, o.entryDir].every((p) => instance.inside(p, boundary))) throw new Error("验收环境的卸载只能处理验收目录中的程序、数据和命令入口");
  }

  const p = { profile, data, purge: Boolean(o.purge), loginItem: null, stop: null, remove: [], trash: [], keep: [], manual: [], blockers: [] };

  const gate = readJson(path.join(data, "operations", "update.json"));
  if (gate && alive(gate.pid)) p.blockers.push("dotjar 正在更新，等更新结束后再卸载");

  if (production && process.platform === "darwin") {
    const id = readJson(path.join(data, "instance.json"))?.id;
    const label = same(data, instance.defaultDataDir()) ? service.LABEL : id ? `${service.LABEL}.${id}` : null;
    const plist = label && path.join(o.launchAgents, `${label}.plist`);
    if (plist && exists(plist)) {
      const program = (fs.readFileSync(plist, "utf8").match(/<key>ProgramArguments<\/key>\s*<array>\s*<string>[^<]*<\/string>\s*<string>([^<]*)<\/string>/) || [])[1];
      p.loginItem = { label, plist, program: program ? program.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") : null };
    }
  }

  const pid = readJson(path.join(data, "web.pid"));
  if (pid && alive(pid.pid)) p.stop = { pid: pid.pid, port: pid.port };

  const removing = [];
  const launcher = path.join(o.base, "launcher", "bin", "dotjar.js");
  let managed = false;
  if (exists(o.base)) {
    const record = readJson(path.join(o.base, "installation.json"));
    if (record && typeof record.dataDir === "string" && same(record.dataDir, data)) {
      managed = true;
      p.remove.push({ path: o.base, what: "托管程序（含历次版本和运行环境）" });
      removing.push(o.base);
    } else if (record) {
      p.keep.push(`托管安装 ${config.tildify(o.base)} 属于另一个数据目录 ${record.dataDir}，未处理`);
    } else {
      p.keep.push(`托管安装目录 ${config.tildify(o.base)} 不完整（没有安装记录），请检查后自行处理`);
    }
  }

  const entry = path.join(o.entryDir, "dotjar");
  if (exists(entry)) {
    const target = entryLauncher(entry);
    if (target && ((managed && same(target, launcher)) || !exists(target))) {
      p.remove.push({ path: entry, what: "命令入口" });
      removing.push(entry);
    } else {
      p.keep.push(`${config.tildify(entry)} ${target ? "指向另一份安装" : "不是 dotjar 写入的命令入口"}，未处理`);
    }
  }

  // A verification never reaches into the person's own npm cache.
  if (production || instance.inside(o.npmCache, process.env.DOTJAR_VERIFY_ROOT)) {
    for (const copy of npxCopies(o.npmCache)) {
      p.remove.push({ path: copy.path, what: `npx 缓存（${copy.spec}）` });
      removing.push(copy.path);
    }
  }

  const cfg = readJson(path.join(data, "config.json")) || {};
  const deposits = cfg.depositDir ? path.resolve(config.expandHome(cfg.depositDir)) : path.join(data, "deposits");
  const outside = !instance.inside(deposits, data);
  if (p.purge) {
    if (exists(data)) {
      const notes = outside ? 0 : countNotes(deposits);
      p.trash.push({ path: data, what: `数据目录（设置、记录、授权${notes ? `，含 ${notes} 篇收下的笔记` : ""}）` });
    }
  } else {
    // Where the program used to live, so nothing tries to start a removed copy.
    const record = readJson(path.join(data, "install.json"));
    if (record?.bin && (!exists(record.bin) || removing.some((dir) => instance.inside(record.bin, dir)))) {
      p.remove.push({ path: path.join(data, "install.json"), what: "程序位置记录" });
    }
    if (exists(data)) p.keep.push(`数据目录 ${config.tildify(data)}（设置、记录和笔记）保留；连同它一起移到废纸篓，加 --purge`);
  }
  if (outside && exists(deposits)) p.keep.push(`笔记目录 ${config.tildify(deposits)} 不会被删除`);
  if (production && !same(data, o.legacy) && exists(o.legacy)) p.keep.push(`旧版数据目录 ${config.tildify(o.legacy)} 未处理`);

  if (production && process.platform === "darwin") {
    if (exists(o.app)) p.manual.push(`把「应用程序」里的 dotjar 移到废纸篓（由安装包写入，需要管理员权限）`);
    const receipts = o.run("pkgutil", ["--pkgs=com\\.dotjar\\..*"]);
    for (const id of (receipts.status === 0 ? receipts.stdout : "").split("\n").map((s) => s.trim()).filter(Boolean)) {
      p.manual.push(`删除安装包记录：sudo pkgutil --forget ${id}`);
    }
  }

  p.empty = !p.loginItem && !p.stop && !p.remove.length && !p.trash.length;
  return p;
}

function describe(p) {
  const t = (s) => config.tildify(s);
  const lines = [];
  if (p.empty) lines.push(`这个账号上没有可以卸载的 dotjar 程序（数据目录：${t(p.data)}）。`);
  else {
    lines.push(`将要卸载 dotjar（数据目录：${t(p.data)}）：`);
    if (p.loginItem) lines.push(`  取消登录时自动启动：${p.loginItem.label}${p.loginItem.program ? `（${t(p.loginItem.program)}）` : ""}`);
    if (p.stop) lines.push(`  停止后台服务：PID ${p.stop.pid}${p.stop.port ? `，端口 ${p.stop.port}` : ""}`);
    for (const item of p.remove) lines.push(`  ${act("删除", item.what)}：${t(item.path)}`);
    for (const item of p.trash) lines.push(`  把${item.what}移到废纸篓：${t(item.path)}`);
  }
  if (p.keep.length) lines.push("保留：", ...p.keep.map((s) => `  ${s}`));
  if (p.manual.length) lines.push("需要你自己完成：", ...p.manual.map((s) => `  ${s}`));
  if (p.blockers.length) lines.push("现在不能卸载：", ...p.blockers.map((s) => `  ${s}`));
  return lines;
}

// Stop the server for this data folder. One started by another copy of
// dotjar answers only to that copy, so that copy is asked to stop it.
async function stopService(p, o) {
  const { pid } = p.stop;
  const gone = async (ms) => {
    for (let waited = 0; waited < ms && alive(pid); waited += 100) await sleep(100);
    return !alive(pid);
  };
  if (await gone(p.loginItem ? 5000 : 0)) return;
  try {
    await service.stop();
  } catch {
    // identity could not be confirmed from here; ask the owner below
  }
  if (await gone(4000)) return;
  const owner = readJson(path.join(p.data, "install.json"))?.bin;
  if (owner && exists(owner)) o.run(process.execPath, [owner, "stop"], { env: { ...process.env, DOTJAR_HOME: p.data } });
  if (await gone(4000)) return;
  throw new Error(`后台服务（PID ${pid}）无法确认身份，未删除任何程序文件。请先用启动它的入口停止${owner ? `（node ${owner} stop）` : ""}，再重新卸载。`);
}

async function execute(p, options = {}) {
  const o = { ...defaults(), ...options };
  if (p.blockers.length) throw new Error(p.blockers.join("；"));
  const done = [];
  if (p.loginItem) {
    o.run("launchctl", ["bootout", `gui/${o.uid}/${p.loginItem.label}`]);
    fs.rmSync(p.loginItem.plist, { force: true });
    done.push("已取消登录时自动启动");
  }
  if (p.stop) {
    await stopService(p, o);
    done.push(`已停止后台服务（PID ${p.stop.pid}）`);
  }
  const pidFile = path.join(p.data, "web.pid");
  if (!alive(readJson(pidFile)?.pid)) fs.rmSync(pidFile, { force: true });
  // The copy running this goes last, after everything it still needs is done.
  const self = path.resolve(__dirname, "..");
  const order = [...p.remove].sort((a, b) => instance.inside(self, a.path) - instance.inside(self, b.path));
  for (const item of order) {
    fs.rmSync(item.path, { recursive: true, force: true });
    done.push(`${act("已删除", item.what)}：${config.tildify(item.path)}`);
  }
  for (const item of p.trash) {
    // A verification's data is made up and inside its own folder.
    if (p.profile === "verify") fs.rmSync(item.path, { recursive: true, force: true });
    else o.trash(item.path);
    done.push(`已把${item.what}移到废纸篓：${config.tildify(item.path)}`);
  }
  return done;
}

module.exports = { plan, describe, execute, entryLauncher, npxCopies };
