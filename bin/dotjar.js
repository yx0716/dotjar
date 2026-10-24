#!/usr/bin/env node
"use strict";

// Headless entry point: the same scan and distillation the veil runs, printed
// to the terminal. Handy for checking what the app would see and send.

const config = require("../src/core/config");
const ledger = require("../src/core/ledger");
const dotjar = require("../src/core/dotjar");
const { buildDigest } = require("../src/core/day");
const { buildPrompt } = require("../src/core/distill");

const USAGE = `用法：dotjar <命令>

  scan      扫描今天：有多少段工作，agent 已经写下了什么
  digest    打印会交给模型的材料
  prompt    打印完整的整理提示词
  distill   调用本地 claude 整理今天，结果写入台账
  show      打印今天台账里的候选
  library   重新生成汇总页（所有留下的笔记合成一个 HTML），打印它的路径
  web       在浏览器里用（npm start 就是它）：服务在后台跑起来，页面在浏览器里打开
            --port <n> 指定端口（默认 4747）  --no-open 不打开浏览器  --foreground 留在这个终端里跑
  stop      停掉后台的服务
  service   install：登录时自动启动，之后只用开收藏夹   uninstall：取消   status：看看现在怎样
  demo      用演示数据在浏览器里看看样子，不读本机任何东西
`;

function line(s = "") {
  process.stdout.write(s + "\n");
}

async function main() {
  const cmd = process.argv[2];
  const cfg = config.load();

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
    const recent = ledger.recentTitles(14, scanned.window.key);
    line(buildPrompt({ dayKey: scanned.window.key, digest: digest.text, settled: scanned.settled, kept: recent.kept, skipped: recent.skipped }));
    return;
  }

  if (cmd === "distill") {
    process.stderr.write("正在整理…\n");
    const res = await dotjar.distillToday(cfg);
    const cost = res.costUsd == null ? "" : `，花费 $${res.costUsd.toFixed(4)}`;
    process.stderr.write(`整理完成：${res.found} 条，用时 ${Math.round((res.durationMs || 0) / 1000)} 秒${cost}\n\n`);
    printCandidates(res.view);
    return;
  }

  if (cmd === "web") {
    const server = require("../src/server");
    const service = require("../src/service");
    const args = process.argv.slice(3);
    const portAt = args.indexOf("--port");
    const port = portAt === -1 ? undefined : Number(args[portAt + 1]);
    const open = !args.includes("--no-open");

    if (args.includes("--foreground")) {
      const res = await server.start({ port, restartable: true });
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
    else line("这个终端可以关了。停掉用 npm run stop；想登录时自动启动、以后不用再跑命令，跑一次 npm run service。");
    return;
  }

  if (cmd === "stop") {
    const service = require("../src/service");
    if (service.installed()) {
      line("dotjar 现在是登录时自动启动的，停了也会被系统拉起来。要彻底停掉：npm run service:off");
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
      line("取消：npm run service:off");
    } else if (sub === "uninstall") {
      line(service.uninstall() ? "已取消登录时自动启动，服务也停了。" : "本来就没有设成自动启动。");
    } else {
      const now = await service.running();
      line(`登录时自动启动：${service.installed() ? "是" : "否"}`);
      line(now ? `正在运行：http://127.0.0.1:${now.port}/` : "现在没有在跑。");
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

  process.stdout.write(USAGE);
  process.exitCode = cmd ? 1 : 0;
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
