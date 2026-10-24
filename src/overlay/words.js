"use strict";

// Every word the interface says, in one place, in Chinese and in English.
//
// Two layers. The wording is what "keeping something for the long run" is
// called: in Chinese there are several complete sets to choose from (config
// `wording`), in English there is one. Around it sits the rest of the
// interface text, one table per language (config `language`).
//
// The text is written the way a person would say it out loud: short, plain
// verbs, no slogans. Used by the page, the desktop shell and the library.

(function (root) {
  const WORDINGS = {
    // 落库: it has landed in the store, and is yours from now on.
    落库: {
      title: "今日落库",
      keep: "落库",
      tabOpen: "待落库",
      tabDone: "已落库",
      library: "库存",
      mine: "你落库的",
      keptTo: (p) => `已落库，存在 ${p}`,
      doneToday: (n) => `今天已经落库 ${n} 条`,
      noneToday: "今天还没有落库",
      decided: (k, s) => `落库 ${k} 条，略过 ${s} 条。`,
      nothingYet: "今天还没有可落库的",
      libSummary: (n, p) => `你落库了 ${n} 篇，agent 另外写下 ${p} 处。`,
      libEmpty: "库存还是空的。",
      onlyMine: "只看我落库的",
    },
    // Saving up, the way one saves coins.
    攒: {
      title: "今天攒了什么",
      keep: "攒下",
      tabOpen: "值得攒",
      tabDone: "已攒下",
      library: "家底",
      mine: "你攒的",
      keptTo: (p) => `已攒下，存在 ${p}`,
      doneToday: (n) => `今天已经攒下 ${n} 条`,
      noneToday: "今天还没攒下什么",
      decided: (k, s) => `攒下 ${k} 条，略过 ${s} 条。`,
      nothingYet: "今天还没有可攒的",
      libSummary: (n, p) => `你攒了 ${n} 篇，agent 另外写下 ${p} 处。`,
      libEmpty: "家底还是空的。",
      onlyMine: "只看我攒的",
    },
    // Takeaways: what you can carry to the next project.
    带走: {
      title: "今天能带走什么",
      keep: "带走",
      tabOpen: "能带走",
      tabDone: "已带走",
      library: "背包",
      mine: "你带走的",
      keptTo: (p) => `已带走，存在 ${p}`,
      doneToday: (n) => `今天已经带走 ${n} 条`,
      noneToday: "今天还没带走什么",
      decided: (k, s) => `带走 ${k} 条，略过 ${s} 条。`,
      nothingYet: "今天还没有可带走的",
      libSummary: (n, p) => `你带走了 ${n} 篇，agent 另外写下 ${p} 处。`,
      libEmpty: "背包还是空的。",
      onlyMine: "只看我带走的",
    },
    // A save point, as in a game.
    存档: {
      title: "今日存档",
      keep: "存档",
      tabOpen: "待存档",
      tabDone: "已存档",
      library: "档案",
      mine: "你存档的",
      keptTo: (p) => `已存档到 ${p}`,
      doneToday: (n) => `今天已经存档 ${n} 条`,
      noneToday: "今天还没有存档",
      decided: (k, s) => `存档 ${k} 条，略过 ${s} 条。`,
      nothingYet: "今天还没有可存档的",
      libSummary: (n, p) => `你存档了 ${n} 篇，agent 另外写下 ${p} 处。`,
      libEmpty: "档案还是空的。",
      onlyMine: "只看我存档的",
    },
    // 落袋为安: the gain is only yours once it is in the pocket.
    落袋: {
      title: "落袋为安",
      keep: "落袋",
      tabOpen: "待落袋",
      tabDone: "已落袋",
      library: "口袋",
      mine: "你落袋的",
      keptTo: (p) => `已落袋，存在 ${p}`,
      doneToday: (n) => `今天已经落袋 ${n} 条`,
      noneToday: "今天还没有落袋",
      decided: (k, s) => `落袋 ${k} 条，略过 ${s} 条。`,
      nothingYet: "今天还没有可落袋的",
      libSummary: (n, p) => `你落袋了 ${n} 篇，agent 另外写下 ${p} 处。`,
      libEmpty: "口袋还是空的。",
      onlyMine: "只看我落袋的",
    },
    // Named after a dot: each thing kept is one.
    波点: {
      title: "收集今天的波点",
      keep: "收集",
      tabOpen: "待收集",
      tabDone: "已收集",
      library: "波点集",
      mine: "你收集的",
      keptTo: (p) => `已收集，存在 ${p}`,
      doneToday: (n) => `今天已经收集 ${n} 颗波点`,
      noneToday: "今天还没有收集到波点",
      decided: (k, s) => `收集 ${k} 颗，略过 ${s} 条。`,
      nothingYet: "今天还没有可收集的",
      libSummary: (n, p) => `你收集了 ${n} 颗波点，agent 另外写下 ${p} 处。`,
      libEmpty: "波点集还是空的。",
      onlyMine: "只看我收集的",
    },
    // 颗粒归仓: every grain into the barn.
    归仓: {
      title: "颗粒归仓",
      keep: "归仓",
      tabOpen: "待归仓",
      tabDone: "已归仓",
      library: "谷仓",
      mine: "你归仓的",
      keptTo: (p) => `已归仓，存在 ${p}`,
      doneToday: (n) => `今天已经归仓 ${n} 条`,
      noneToday: "今天还没有归仓",
      decided: (k, s) => `归仓 ${k} 条，略过 ${s} 条。`,
      nothingYet: "今天还没有可归仓的",
      libSummary: (n, p) => `你归仓了 ${n} 篇，agent 另外写下 ${p} 处。`,
      libEmpty: "谷仓还是空的。",
      onlyMine: "只看我归仓的",
    },
  };

  const DEFAULT = "落库";
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const EN_WORDING = {
    title: "Today's keepers",
    keep: "Keep",
    tabOpen: "Worth keeping",
    tabDone: "Kept",
    library: "Library",
    mine: "kept by you",
    keptTo: (p) => `Kept. Saved to ${p}`,
    doneToday: (n) => `${n} kept today`,
    noneToday: "Nothing kept yet today",
    decided: (k, s) => `Kept ${k}, skipped ${s}.`,
    nothingYet: "Nothing to keep yet today",
    libSummary: (n, p) => `You kept ${plural(n, "note", "notes")}. Agents wrote in ${plural(p, "other place", "other places")}.`,
    libEmpty: "Nothing here yet.",
    onlyMine: "Only mine",
  };

  const WEEK_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const WEEK_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function dateOf(key) {
    const [y, m, d] = String(key).split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  const UI = {
    zh: {
      lang: "zh",
      kinds: { note: "心得", rule: "规则", skill: "流程", memory: "记忆" },
      you: "你",
      ai: "AI",
      doubt: "存疑",
      sep: "、",
      tabToday: "今天",
      close: "收起",
      tabHint: (key) => `按 ${key} 切换`,
      date: (key) => `${dateOf(key).getMonth() + 1}月${dateOf(key).getDate()}日 ${WEEK_ZH[dateOf(key).getDay()]}`,
      // Who goes through the day: as it reads inside a sentence, and as a name.
      engineFull: (id, model) => (id === "openai" ? model || "模型接口" : id === "codex-cli" ? "本地的 Codex" : "本地的 Claude"),
      engineShort: (id, model) => (id === "openai" ? model || "模型接口" : id === "codex-cli" ? "Codex" : "Claude"),
      engineBtn: (name) => `用 ${name} 整理`,
      engineHint: (next) => `点一下换成 ${next}`,
      engineSwitched: (name) => `已改用 ${name} 整理`,

      overviewTitle: (n, dots) => (dots ? `今天做了 ${n} 件事，捡到 ${dots} 个波点` : `今天做了 ${n} 件事`),
      dotsKey: (kept, open, w, ask) => `<span>${ask}提问</span><span>${kept}${w.tabDone}</span><span>${open}${w.tabOpen}</span>`,
      dotsLoose: (n) => `另外 ${n} 个，没认出是哪件事的`,
      roughTitle: "今天的记录还没整理",
      overviewRough: (n) => `今天开了 ${n} 段对话`,
      roughTitleDone: (n) => `今天动了 ${n} 个项目`,
      roughKey: "整理一下，看看今天有什么值得留下来。",
      see: (n, w) => `看 ${n} 条${w.tabOpen}`,
      openLib: (w) => `打开${w.library}`,
      asks: (n) => `${n} 次提问`,

      loading: "正在读今天的记录…",
      loadFail: "今天的记录没读出来",
      reload: "再读一次",
      distill: "整理今天",
      distillAgain: "再整理一遍",
      distillMore: (n) => (n ? `又挑出 ${n} 条新的` : "这次没挑出新的"),
      refreshNew: (n) => `之后又问了 ${n} 次，再整理一遍`,
      distilling: "正在整理今天",
      distillingText: (engine) => `${engine} 正在读今天的记录，大概要半分钟到一分钟。`,
      distillingStatus: (secs) => `已经 ${secs} 秒，可以先去忙别的，不会中断。`,
      distillFail: "整理没完成",
      retry: "再试一次",
      distillDone: (n) => `整理完了，挑出 ${n} 条`,
      distillNone: "整理完了，这次没挑出新的",

      notYetText: (engine) => `让${engine} 读一遍今天的记录，把以后还会用到的挑出来。`,
      pasteText: (key) => `今天还没有和 agent 的对话。在网页或别的应用里聊过的，复制下来${key ? `按 ${key}` : "回到这里按 ⌘V"}，也能算进今天。`,
      pasteBtn: "粘贴到今天",
      decidedTitle: "今天的都处理完了",
      nothingTitle: "今天没有要处理的",
      nothingText: "整理过了，没挑出值得留下的，不是每天都有。",

      from: (projects) => `来自 ${projects.join("、")}`,
      usefulWhen: "什么时候用得上",
      skip: "略过",
      copy: "复制",
      savesTo: (p) => `存到 ${p}`,
      change: "换位置",
      prev: "上一条",
      next: "下一条",

      settledHint: "你落库的，和 agent 自己写进笔记、规则、记忆、skill 的，都在这里。",
      rowNew: "新建",
      rowUpdated: "有更新",
      rowMore: (n) => `，另有 ${n} 处`,
      reveal: "在访达中显示",

      undo: "撤销",
      skipped: "已略过",
      copied: "已复制",
      putBack: "已放回",
      captured: "已加入今天",
      browse: "翻看",
      // The calendar under the date.
      calTitle: (y, m) => `${y}年${m}月`,
      calWeek: ["一", "二", "三", "四", "五", "六", "日"],
      calThings: (n) => `${n} 件`,
      calNotYet: "没整理",
      calOpen: (n) => `${n} 待定`,
      calLoading: "正在查这个月的记录…",
      calTickAll: "全选没整理的",
      calGo: (n) => (n ? `打捞选中的 ${n} 天` : "先勾选日子"),
      calNote: (engine) => `勾选后由${engine} 逐天整理；直接点日期是查看那一天。`,
      calTick: (label) => `勾选 ${label}`,
      calPrevMonth: "上个月",
      calNextMonth: "下个月",
      batchText: (n) => `一共 ${n} 天，逐天整理，可以先去忙别的。`,
      batchStatus: (done, total, label) => `正在打捞第 ${done + 1}/${total} 天：${label}`,
      batchDone: (n, found) => `打捞完了 ${n} 天，挑出 ${found} 条`,
      batchFailed: (n) => `，${n} 天没有可读的记录`,
      batching: "正在打捞",
      pickDay: "换一天看",
      dayToday: "今天",
      dayThings: (n) => `${n} 件事`,
      dayOpen: (n) => `${n} 条没定`,
      dayNotYet: "还没整理",
      dayUnseen: "还没看过",
      dayOption: (label, parts) => (parts.length ? `${label}：${parts.join("，")}` : label),
      switching: "正在切换…",
      seeYesterday: "看昨天",
      leftFrom: (key, yesterdayKey) => (key === yesterdayKey ? "昨天留下的" : `${dateOf(key).getMonth() + 1}月${dateOf(key).getDate()}日留下的`),
      backToToday: "回到今天",
      agents: (list) => (list.length ? `（${list.map((a) => `${a.name} ${a.sessions}`).join("、")}）` : ""),
      statusDone: (time, projects, sessions, agents, since) =>
        `${time} 整理过：${projects} 个项目，${sessions} 段对话${agents}${since ? `，之后又问了 ${since} 次` : ""}。`,
      statusFresh: (projects, sessions, agents) => `今天 ${projects} 个项目，${sessions} 段对话${agents}。`,
      demoOnly: "演示里打不开，正式运行时会在浏览器里打开",
      errors: {
        NO_CLI: "没找到 claude 命令。在终端跑一下 which claude 看装没装；装不了的话，把 ~/.dotjar/config.json 里的 engine 改成 openai，再填上 api。",
        NO_CODEX: "没找到 codex 命令。在终端跑一下 which codex 看装没装，或者点右上角换成 Claude 来整理。",
        NO_API: "还没配模型接口。在 ~/.dotjar/config.json 的 api 里填 baseUrl 和 model；密钥填 apiKey，或用 apiKeyEnv 指到环境变量。",
        NO_WORK: "今天还没有和 agent 的对话，暂时没什么可整理的。",
      },

      // The library page.
      libUpdated: (key, time) => `${dateOf(key).getMonth() + 1}月${dateOf(key).getDate()}日 ${time} 更新。`,
      libDay: (key) => [`${dateOf(key).getMonth() + 1}月${dateOf(key).getDate()}日`, WEEK_ZH[dateOf(key).getDay()]],
      libSearch: "搜标题和正文",
      libObsidian: "在 Obsidian 里打开",
      libMarkdown: "打开 Markdown",
      libPointer: (name) => `agent 写进《${name}》`,
      libPointerPlain: "agent 写下的",
      libGone: "这个文件后来被删掉或挪走了。",
      libRemove: "移出库存",
      libHide: "不在库存里显示",
      libRemoved: "已移出，笔记放进了 ~/.dotjar/trash",
      libHidden: "不再显示，原文件没动",
      stale: "dotjar 有更新，重启服务后生效",
      restartNow: "重启服务",
      restarting: "正在重启服务…",
      restartFail: "服务没重启起来。在终端跑一下 npm run stop，再跑 npm start",
      libCut: "后面还有，全文在原文件里。",
      libHowTo: (dir) => `在待落库里按 ↵，那一条会存成 Markdown 放进 ${dir}，并出现在这里。`,
      libNone: "没有匹配的条目。",
      libFooter: (dir, library) => `笔记原文在 ${dir}，这一页由它们生成；改了笔记，重新打开${library}就能看到。`,
      libCount: (label, n) => `${label}：${n} 条`,

      // Kept notes.
      whenLabel: "什么时候用上",

      // The desktop shell.
      menuToday: "打开今天",
      menuCapture: "把剪贴板存进今天的材料",
      menuNotes: "打开笔记文件夹",
      menuData: "打开数据文件夹",
      menuHide: "收起",
      menuQuit: "退出 dotjar",
      traySaved: "已存入",
      trayEmpty: "剪贴板是空的",
      chooseFolder: "笔记存到哪个文件夹",
      announce: (key, keep) => `dotjar 在运行。收起之后，按 ${key}、点 Dock 里的图标、或点菜单栏的「${keep}」都能再打开。Ctrl+C 退出。`,
      webFolderPrompt: "笔记存到哪个文件夹？填完整路径",
    },

    en: {
      lang: "en",
      kinds: { note: "Lesson", rule: "Rule", skill: "Routine", memory: "Memory" },
      you: "You",
      ai: "AI",
      doubt: "Check",
      sep: ", ",
      tabToday: "Today",
      close: "Close",
      tabHint: (key) => `Press ${key}`,
      date: (key) => `${WEEK_EN[dateOf(key).getDay()]}, ${MONTH_EN[dateOf(key).getMonth()]} ${dateOf(key).getDate()}`,
      engineFull: (id, model) => (id === "openai" ? model || "your model endpoint" : id === "codex-cli" ? "your local Codex" : "your local Claude"),
      engineShort: (id, model) => (id === "openai" ? model || "endpoint" : id === "codex-cli" ? "Codex" : "Claude"),
      engineBtn: (name) => `Using ${name}`,
      engineHint: (next) => `Click to switch to ${next}`,
      engineSwitched: (name) => `Now using ${name}`,

      overviewTitle: (n, dots) => `${plural(n, "thing", "things")} today${dots ? `, ${plural(dots, "dot", "dots")} picked up` : ""}`,
      dotsKey: (kept, open, w, ask) => `<span>${ask}a question</span><span>${kept}${w.tabDone}</span><span>${open}${w.tabOpen}</span>`,
      dotsLoose: (n) => `${n} more, not clearly from any one of these`,
      roughTitle: "Not gone through yet",
      overviewRough: (n) => `${plural(n, "conversation", "conversations")} today`,
      roughTitleDone: (n) => `${plural(n, "project", "projects")} today`,
      roughKey: "Go through it to see what's worth keeping.",
      see: (n) => `See ${n} worth keeping`,
      openLib: (w) => `Open ${w.library}`,
      asks: (n) => plural(n, "ask", "asks"),

      loading: "Reading today…",
      loadFail: "Couldn't read today",
      reload: "Read again",
      distill: "Go through today",
      distillAgain: "Go through it again",
      distillMore: (n) => (n ? `Found ${n} more` : "Nothing new this time"),
      refreshNew: (n) => `${plural(n, "new ask", "new asks")} since, go through again`,
      distilling: "Going through today",
      distillingText: (engine) => `Having ${engine} read today's conversations and pick out what you'll use again. Usually under a minute.`,
      distillingStatus: (secs) => `${secs}s so far. You can close this; it keeps going.`,
      distillFail: "It didn't finish",
      retry: "Try again",
      distillDone: (n) => `Done. ${n} worth keeping.`,
      distillNone: "Done. Nothing new this time.",

      notYetText: (engine) =>
        `Going through the day means ${engine} reads today's conversations and keeps only what would still help on another project three months from now. It won't tell you what each conversation did.`,
      pasteText: (key) =>
        `Come back after some work with an agent. In any other app, copy some text and ${key ? `press ${key}` : "press ⌘V here"} to add it to today's material.`,
      pasteBtn: "Add clipboard to today",
      decidedTitle: "All decided for today",
      nothingTitle: "Nothing needs your call today",
      nothingText: "Went through it and found nothing worth keeping. Some days are like that.",

      from: (projects) => `From ${projects.join(", ")}`,
      usefulWhen: "Useful when",
      skip: "Skip",
      copy: "Copy",
      savesTo: (p) => `Saves to ${p}`,
      change: "Change",
      prev: "Previous",
      next: "Next",

      settledHint: "What agents wrote into your notes, rules, memory and skills shows up here, along with what you keep.",
      rowNew: "new",
      rowUpdated: "updated",
      rowMore: (n) => `, ${n} more`,
      reveal: "Show in Finder",

      undo: "Undo",
      skipped: "Skipped",
      copied: "Copied",
      putBack: "Put back",
      captured: "Added to today's material",
      browse: "browse",
      calTitle: (y, m) => `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${y}`,
      calWeek: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      calThings: (n) => plural(n, "thing", "things"),
      calNotYet: "not yet",
      calOpen: (n) => `${n} open`,
      calLoading: "Finding which days have records…",
      calTickAll: "Tick the ones not gone through",
      calGo: (n) => (n ? `Go through ${plural(n, "day", "days")}` : "Tick days to go through"),
      calNote: (engine) => `Going through a day has ${engine} read that day's records, once per day. Click a date itself to look at that day.`,
      calTick: (label) => `Tick ${label}`,
      calPrevMonth: "Previous month",
      calNextMonth: "Next month",
      batchText: (n) => `Reading them one day at a time, ${plural(n, "day", "days")} in all. You can close this; it keeps going.`,
      batchStatus: (done, total, label) => `Going through day ${done + 1} of ${total}: ${label}`,
      batchDone: (n, found) => `Went through ${plural(n, "day", "days")}, ${found} worth keeping`,
      batchFailed: (n) => `; ${plural(n, "day had", "days had")} nothing to read`,
      batching: "Going through the picked days",
      pickDay: "Pick a day",
      dayToday: "today",
      dayThings: (n) => plural(n, "thing", "things"),
      dayOpen: (n) => `${n} open`,
      dayNotYet: "not gone through",
      dayUnseen: "not opened yet",
      dayOption: (label, parts) => (parts.length ? `${label}: ${parts.join(", ")}` : label),
      switching: "Loading that day…",
      seeYesterday: "See yesterday",
      leftFrom: (key, yesterdayKey) => (key === yesterdayKey ? "left from yesterday" : `left from ${MONTH_EN[dateOf(key).getMonth()]} ${dateOf(key).getDate()}`),
      backToToday: "Back to today",
      agents: (list) => (list.length ? ` (${list.map((a) => `${a.name} ${a.sessions}`).join(", ")})` : ""),
      statusDone: (time, projects, sessions, agents, since) =>
        `Went through at ${time}: ${plural(projects, "project", "projects")}, ${plural(sessions, "conversation", "conversations")}${agents}${since ? `, ${plural(since, "ask", "asks")} since` : ""}.`,
      statusFresh: (projects, sessions, agents) => `${plural(projects, "project", "projects")}, ${plural(sessions, "conversation", "conversations")} today${agents}.`,
      demoOnly: "Not available in the demo. In the real app this opens in your browser.",
      errors: {
        NO_CLI: "Couldn't find the claude command. Run `which claude` in a terminal to check it is installed. If you can't install it, set engine to openai in ~/.dotjar/config.json and fill in api.",
        NO_CODEX: "Couldn't find the codex command. Run `which codex` in a terminal to check it is installed, or switch to Claude at the top right.",
        NO_API: "No model endpoint set up yet. In ~/.dotjar/config.json, fill in api.baseUrl and api.model; put the key in api.apiKey, or name an environment variable in api.apiKeyEnv.",
        NO_WORK: "No work with an agent recorded today, so there is nothing to go through.",
      },

      libUpdated: (key, time) => `Updated ${MONTH_EN[dateOf(key).getMonth()]} ${dateOf(key).getDate()}, ${time}.`,
      libDay: (key) => [`${MONTH_EN[dateOf(key).getMonth()]} ${dateOf(key).getDate()}`, WEEK_EN[dateOf(key).getDay()]],
      libSearch: "Search titles and text",
      libObsidian: "Open in Obsidian",
      libMarkdown: "Open Markdown",
      libPointer: (name) => `an agent wrote this into “${name}”`,
      libPointerPlain: "written by an agent",
      libGone: "This file was deleted or moved since.",
      libRemove: "Remove",
      libHide: "Hide from the library",
      libRemoved: "Removed; the note is in ~/.dotjar/trash",
      libHidden: "Hidden; the file itself is untouched",
      stale: "dotjar was updated; the server behind this page is still the old one",
      restartNow: "Restart it",
      restarting: "Restarting the server…",
      restartFail: "The server did not come back. Run npm run stop, then npm start, in a terminal.",
      libCut: "There is more; the full text is in the file.",
      libHowTo: (dir) => `Press ↵ on a candidate. It is saved as a Markdown note in ${dir} and then shows up here.`,
      libNone: "No matches.",
      libFooter: (dir, library) => `The notes themselves live in ${dir}. This page is generated from them; reopen the ${library} after editing a note.`,
      libCount: (label, n) => `${label}: ${n}`,

      whenLabel: "Useful when",

      menuToday: "Open today",
      menuCapture: "Add clipboard to today's material",
      menuNotes: "Open notes folder",
      menuData: "Open data folder",
      menuHide: "Close",
      menuQuit: "Quit dotjar",
      traySaved: "Saved",
      trayEmpty: "Clipboard is empty",
      chooseFolder: "Folder for kept notes",
      announce: (key, keep) => `dotjar is running. After closing the veil, press ${key}, click the Dock icon, or click “${keep}” in the menu bar to bring it back. Ctrl+C quits.`,
      webFolderPrompt: "Folder for kept notes (full path)",
    },
  };

  // "zh" or "en" from a language setting or a locale string.
  function language(value) {
    const v = String(value || "").toLowerCase();
    if (v.startsWith("en")) return "en";
    if (v.startsWith("zh")) return "zh";
    return "";
  }

  // The strings that name the day being looked at. First thing in the morning
  // that day is yesterday, and these are the ones that have to say so.
  const ABOUT_THE_DAY = [
    "title", "tabToday", "overviewTitle", "overviewRough", "roughTitle", "roughTitleDone", "loading", "loadFail", "distill", "distilling",
    "distillingText", "notYetText", "decidedTitle", "nothingTitle", "statusFresh", "doneToday", "noneToday",
  ];

  // In English a date reads "on Oct 12" in most of these, but bare in a few.
  const BARE_DATE = new Set(["distill", "distilling", "loading", "loadFail", "decidedTitle"]);

  // Say the day that is actually on screen: yesterday, or an earlier date.
  function asDay(text, lang, daysBack, dayKey, name) {
    const t = String(text);
    const d = dateOf(dayKey);
    if (lang === "zh") {
      if (daysBack === 1) return t.replace(/今天/g, "昨天").replace(/今日/g, "昨日");
      const date = `${d.getMonth() + 1}月${d.getDate()}日`;
      // A half-width number after a Chinese character takes a space.
      return t.replace(/今天|今日/g, date).replace(/([\u4e00-\u9fff])(\d+月)/g, "$1 $2");
    }
    if (daysBack === 1) return t.replace(/Today/g, "Yesterday").replace(/today/g, "yesterday");
    const date = `${MONTH_EN[d.getMonth()]} ${d.getDate()}`;
    return t
      .replace(/[Tt]oday's/g, `${date}'s`)
      .replace(/Today/g, date)
      .replace(/today/g, BARE_DATE.has(name) ? date : `on ${date}`);
  }

  // The complete text for one language: the interface table with the wording
  // laid over it, so callers read every string off one object. `daysBack` and
  // `dayKey` say which day is on screen when it is not today.
  function copy(lang, wording, daysBack, dayKey) {
    const l = language(lang) || "zh";
    const w = l === "en" ? EN_WORDING : WORDINGS[wording] || WORDINGS[DEFAULT];
    const all = { ...UI[l], ...w };
    if (!daysBack) return all;
    for (const key of ABOUT_THE_DAY) {
      const value = all[key];
      all[key] = typeof value === "function" ? (...args) => asDay(value(...args), l, daysBack, dayKey, key) : asDay(value, l, daysBack, dayKey, key);
    }
    return all;
  }

  // The Chinese wording alone, as earlier callers expect.
  function pick(name) {
    return WORDINGS[name] || WORDINGS[DEFAULT];
  }

  const api = { copy, pick, language, names: Object.keys(WORDINGS), DEFAULT };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DotjarWords = api;
})(typeof window !== "undefined" ? window : globalThis);
