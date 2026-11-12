#!/usr/bin/env node
"use strict";

// The way in. With no command it starts the page and opens it in the
// browser, which is all most people ever need: `npx github:yx0716/dotjar`.
// The other commands run the same scan and pass the page runs, printed to
// the terminal: handy for checking what it would see and send.

const config = require("../src/core/config");
const ledger = require("../src/core/ledger");
const dotjar = require("../src/core/dotjar");
const { buildDigest } = require("../src/core/day");
const { buildPrompt } = require("../src/core/distill");

const USAGE = `用法：dotjar [命令]

  （不带命令）  启动，并在浏览器里打开。服务在后台跑，终端可以关掉
                --port <n> 指定端口（默认 4747）  --no-open 不打开浏览器  --foreground 留在这个终端里跑
  update        check：检查新版   status：查看状态   install：更新托管版并重启
  install-managed  --version <版本> --entry-dir <命令目录>（可选）
                   首次安装或迁移到可一键更新的托管版（macOS）
  demo          用演示数据看看样子，不读本机任何东西
  stop          停掉后台的服务
  service       install：登录时自动启动，之后只用开收藏夹   uninstall：取消   status：看看现在怎样
  uninstall     删除程序、命令入口和登录启动项，保留记录和笔记；先列出要做的事，确认后才执行
                --purge 连数据目录一起移到废纸篓  --yes 不再询问  --entry-dir <命令目录>

  scan          扫描今天：有多少段工作，agent 已经写下了什么
  digest        打印会交给模型的材料
  prompt        打印完整的打捞提示词
  distill       打捞今天，结果写入台账
  show          打印今天台账里的候选
  library       重新生成星罐（所有留下的笔记合成一个 HTML），打印它的路径
`;

// How this was started, so that what is printed can be typed back as it is:
// through npx, through the scripts of a clone, or as an installed command.
const viaNpx = process.env.npm_lifecycle_event === "npx" || process.env.npm_command === "exec";

function again(sub) {
  const env = process.env;
  if (viaNpx) return `npx github:yx0716/dotjar${sub ? ` ${sub}` : ""}`;
  if (env.npm_lifecycle_event) return { "": "npm start", stop: "npm run stop", "service install": "npm run service", "service uninstall": "npm run service:off" }[sub] || `npm run ${sub}`;
  return `${/\.js$/.test(process.argv[1] || "") ? "node bin/dotjar.js" : "dotjar"}${sub ? ` ${sub}` : ""}`;
}

function line(s = "") {
  process.stdout.write(s + "\n");
}

async function main() {
  // No command, or only flags: start the page.
  const first = process.argv[2];
  const cmd = !first || first.startsWith("--port") || first === "--no-open" || first === "--foreground" ? "web" : first;
  // A source checkout must opt into its own data context. A bare npm start
  // must never silently become the customer's production installation.
  if (!["help", "--help", "-h", "--version", "-v", "demo"].includes(cmd)) require("../src/core/instance").assertIsolatedSource(require("path").resolve(__dirname, ".."));
  const cfg = config.load();

  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(USAGE);
    return;
  }
  if (cmd === "--version" || cmd === "-v") {
    line(require("../package.json").version);
    return;
  }

  const option = (name) => { const i = process.argv.indexOf(name); if (i === -1) return undefined; if (!process.argv[i + 1] || process.argv[i + 1].startsWith("--")) throw new Error(`${name} 缺少值`); return process.argv[i + 1]; };
  if (cmd === "install-managed") {
    const result = await require("../src/update/install").install({ version: option("--version"), entryDir: option("--entry-dir") });
    line(`已安装 ${result.version}：${result.entry}，请确保 ~/.local/bin 在 PATH 中。`);
    line(result.output);
    return;
  }
  if (cmd === "update") {
    const updates = require("../src/update/manager");
    const action = process.argv[3] || "status";
    if (!["check", "status", "install"].includes(action)) throw new Error("用法：dotjar update check|status|install");
    let result = action === "status" ? updates.status() : await updates.check();
    if (action === "install") {
      if (result.error) throw new Error(result.error);
      if (!result.available) { line("当前没有可用的新版本"); return; }
      result = await updates.start(result.latest);
    }
    line(JSON.stringify(result, null, 2));
    return;
  }

  if (cmd === "scan") {
    const scanned = await dotjar.scan(cfg);
    const v = dotjar.view(cfg, scanned);
    line(`${v.label.date} ${v.label.weekday}：${v.stats.projects} 个项目，${v.stats.sessions} 段工作，${v.stats.turns} 次提问`);
    line(`来自：${v.stats.agents.map((a) => `${a.name} ${a.sessions} 段`).join("、") || "（今天没有读到任何 agent 的记录）"}`);
    line();
    line(`agent 已经写下 ${scanned.settled.length} 处：`);
    for (const s of scanned.settled) {
      const gist = s.gists.length ? s.gists.join("；") : s.isNew ? "新建" : "有更新";
      line(`  [${ledger.KIND_LABEL[s.kind]}] ${s.name}  ←  ${gist}  (${s.where})`);
    }
    return;
  }

  if (cmd === "digest" || cmd === "prompt") {
    const scanned = await dotjar.scan(cfg);
    const digest = buildDigest(scanned.sessions);
    if (cmd === "digest") {
      line(digest.text);
      process.stderr.write(`\n${JSON.stringify(digest.stats)}\n`);
      return;
    }
    const recent = ledger.recentTitles(30, scanned.window.key);
    const pending = [...ledger.backlog(scanned.window.key), ...scanned.day.items.filter((i) => i.status === "open")].map((i) => i.title);
    line(buildPrompt({ dayKey: scanned.window.key, digest: digest.text, settled: scanned.settled, kept: recent.kept, pending, skipped: recent.skipped }));
    return;
  }

  if (cmd === "distill") {
    process.stderr.write("正在打捞…\n");
    const res = await dotjar.distillToday(cfg);
    const cost = res.costUsd == null ? "" : `，花费 $${res.costUsd.toFixed(4)}`;
    process.stderr.write(`捞完了：${res.found} 颗，用时 ${Math.round((res.durationMs || 0) / 1000)} 秒${cost}\n\n`);
    printCandidates(res.view);
    return;
  }

  if (cmd === "web") {
    const server = require("../src/server");
    const service = require("../src/service");
    const args = process.argv.slice(first === "web" ? 3 : 2);
    const portAt = args.indexOf("--port");
    const port = portAt === -1 ? undefined : Number(args[portAt + 1]);
    const open = !args.includes("--no-open");

    if (args.includes("--foreground")) {
      const existing = await service.running();
      if (existing) { if (open) server.openInBrowser(existing.url); line(`dotjar 已经在 ${existing.port} 端口运行。`); return; }
      const res = await server.start({ port, restartable: true, watchRest: true });
      if (res.reused) {
        line(`dotjar 已经在 ${res.port} 端口运行。`);
        return;
      }
      service.writePid(res.port);
      const bye = () => {
        service.clearPid();
        process.exit(0);
      };
      process.on("SIGINT", bye);
      process.on("SIGTERM", bye);
      if (open) server.openInBrowser(res.url);
      line(`dotjar 在运行：http://127.0.0.1:${res.port}/`);
      line(`第一次用这个带授权的地址打开：${res.url}`);
      return;
    }

    // The usual way: leave the server running in the background and hand
    // the terminal back.
    const already = await service.current();
    if (already && already.fresh) line("后台的 dotjar 还在跑旧代码，已经换成新的。");
    const res = already || (await service.startInBackground({ port }));
    if (open) server.openInBrowser(res.url);
    line(`dotjar 在后台运行，页面${open ? "已经在浏览器里打开" : "地址见下"}：http://127.0.0.1:${res.port}/`);
    line(`第一次用这个带授权的地址打开，之后收藏上面那个就行：${res.url}`);
    if (service.installed()) line("它已经设成登录时自动启动，以后不用再跑命令。");
    else {
      line(`这个终端可以关了。停掉：${again("stop")}`);
      // Run through npx it lives in npx's cache, which is no place for
      // something the system is to start at every login.
      line(viaNpx ? "想登录时自动启动、以后只开收藏夹：先 npm install -g github:yx0716/dotjar，再 dotjar service install" : `想登录时自动启动、以后只开收藏夹：${again("service install")}`);
    }
    return;
  }

  if (cmd === "stop") {
    const service = require("../src/service");
    if (service.installed()) {
      line(`dotjar 现在是登录时自动启动的，停了也会被系统拉起来。要彻底停掉：${again("service uninstall")}`);
      return;
    }
    line((await service.stop()) ? "已停掉。" : "后台没有在跑的 dotjar。");
    return;
  }

  if (cmd === "service") {
    const server = require("../src/server");
    const service = require("../src/service");
    const sub = process.argv[3] || "status";
    if (sub === "install") {
      const res = await service.install();
      server.openInBrowser(res.url);
      line(`装好了。以后登录就自动启动，收藏这个地址即可：http://127.0.0.1:${res.port}/`);
      line(`第一次用这个带授权的地址打开：${res.url}`);
      line(`取消：${again("service uninstall")}`);
    } else if (sub === "uninstall") {
      line(service.uninstall() ? "已取消登录时自动启动，服务也停了。" : "本来就没有设成自动启动。");
    } else {
      const now = await service.running();
      line(`登录时自动启动：${service.installed() ? "是" : "否"}`);
      line(now ? `正在运行：http://127.0.0.1:${now.port}/` : "现在没有在跑。");
    }
    return;
  }

  if (cmd === "uninstall") {
    const uninstall = require("../src/uninstall");
    const args = process.argv.slice(3);
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--entry-dir") i++;
      else if (!["--purge", "--yes"].includes(args[i])) throw new Error(`用法：${again("uninstall")} [--purge] [--yes] [--entry-dir <命令目录>]`);
    }
    const entryDir = option("--entry-dir");
    const options = { purge: args.includes("--purge"), ...(entryDir ? { entryDir: require("path").resolve(entryDir) } : {}) };
    const plan = uninstall.plan(options);
    for (const l of uninstall.describe(plan)) line(l);
    if (plan.empty || plan.blockers.length) {
      if (plan.blockers.length) process.exitCode = 1;
      return;
    }
    if (!args.includes("--yes")) {
      if (!process.stdin.isTTY) throw new Error(`没有改动。确认无误后运行：${again(["uninstall", ...args, "--yes"].join(" "))}`);
      const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise((resolve) => rl.question("继续卸载？[y/N] ", resolve));
      rl.close();
      if (!/^y(es)?$/i.test(answer.trim())) {
        line("已取消，没有改动。");
        return;
      }
    }
    for (const l of await uninstall.execute(plan, options)) line(l);
    if (plan.manual.length) {
      line("还需要你自己完成：");
      for (const s of plan.manual) line(`  ${s}`);
    }
    return;
  }

  if (cmd === "demo") {
    const { pathToFileURL } = require("url");
    const file = require("path").join(__dirname, "..", "src", "overlay", "overlay.html");
    require("../src/server").openInBrowser(pathToFileURL(file).href);
    line("演示页已经在浏览器里打开，里面是编出来的一天，没有读本机的任何东西。");
    return;
  }

  if (cmd === "library") {
    line(require("../src/core/library").build(cfg));
    return;
  }

  if (cmd === "show") {
    printCandidates(await dotjar.today(cfg));
    return;
  }

  process.stderr.write(`没有 ${cmd} 这个命令。\n\n`);
  process.stdout.write(USAGE);
  process.exitCode = 1;
}

function printCandidates(v) {
  if (!v.candidates.length) {
    line("没有待定的候选。");
    return;
  }
  for (const c of v.candidates) {
    line(`[${ledger.KIND_LABEL[c.kind]}] ${c.title}`);
    if (c.payoff) line(`  用上的时候：${c.payoff}`);
    if (c.projects.length) line(`  取材：${c.projects.join("、")}`);
    line();
    line(c.draft.split("\n").map((l) => "  " + l).join("\n"));
    line();
  }
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
});
