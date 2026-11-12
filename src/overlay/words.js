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
    // 打捞: the day is a river of stars; a pass over it brings a few up in
    // the net, and the ones worth having go into the jar.
    打捞: {
      title: "今日打捞",
      keep: "收下",
      tabOpen: "捞到的",
      tabDone: "已留下",
      library: "星罐",
      mine: "你收下的",
      keptTo: (p) => `已收进罐子，存在 ${p}`,
      doneToday: (n) => `今天留下了 ${n} 条`,
      noneToday: "今天还没有留下的",
      decided: (k, s) => `收下 ${k} 颗，略过 ${s} 颗。`,
      nothingYet: "今天还没有可打捞的",
      libSummary: (n, p) => `罐子里有你收下的 ${n} 颗星，agent 另外写下 ${p} 处。`,
      libEmpty: "罐子还是空的。",
      onlyMine: "只看我收下的",
      seeOpen: (n) => `看看捞到的 ${n} 颗`,
    },
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
      seeOpen: (n) => `看 ${n} 条待落库`,
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
      seeOpen: (n) => `看 ${n} 条值得攒的`,
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
      seeOpen: (n) => `看 ${n} 条能带走的`,
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
      seeOpen: (n) => `看 ${n} 条待存档`,
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
      seeOpen: (n) => `看 ${n} 条待落袋`,
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
      seeOpen: (n) => `看 ${n} 条待归仓`,
    },
  };

  const DEFAULT = "打捞";
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const EN_WORDING = {
    title: "Today's catch",
    keep: "Keep",
    tabOpen: "Caught",
    tabDone: "Kept",
    library: "Jar",
    mine: "kept by you",
    keptTo: (p) => `Kept. Saved to ${p}`,
    doneToday: (n) => `${n} kept today`,
    noneToday: "Nothing kept yet today",
    decided: (k, s) => `Kept ${k}, skipped ${s}.`,
    nothingYet: "Nothing to fish for yet today",
    libSummary: (n, p) => `${plural(n, "star", "stars")} of yours in the jar. Agents wrote in ${plural(p, "other place", "other places")}.`,
    libEmpty: "The jar is empty.",
    onlyMine: "Only mine",
    seeOpen: (n) => `See the ${n} you caught`,
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
      // The four a pass turns up, then the four places an agent writes to.
      kinds: { craft: "用法", strategy: "策略", lesson: "经验", trap: "盲点", note: "笔记", rule: "规则", skill: "技能", memory: "记忆" },
      kindHints: {
        craft: "和 agent 配合的手法",
        strategy: "处理一类问题的打法",
        lesson: "处理问题得到的判断",
        trap: "思考时容易漏掉的情况",
      },
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
      engineBtn: (name) => `用 ${name} 打捞`,
      engineHint: (next) => `点一下换成 ${next}`,
      engineSwitched: (name) => `已改用 ${name} 打捞`,

      overviewTitle: (n, stars) => (stars ? `今日银河里，为你打捞起 ${stars} 颗星` : `今天做了 ${n} 件事`),
      dotsKey: (kept, open, w, ask) => `<span>${ask}你的提问</span><span>${open}${w.tabOpen}</span><span>${kept}${w.tabDone}</span>`,
      dotsLoose: (n) => `另外 ${n} 颗，没认出是哪件事的`,
      // How the person is getting on, and what the jar holds.
      growthGood: "做得好",
      growthNext: "下次试试",
      growthUsed: "用上了",
      growthRead: "看过了，收起这条",
      growthUnread: "重新显示这条",
      growthHidden: (n) => `已收起 ${n} 条 · 展开`,
      growthCollapse: "收起已看过的",
      growthReadHint: "勾选只表示看过，不代表认可这条判断",
      growthLocalOnly: "已收起；当前浏览器无法保存，下次打开会重新显示",
      growthUsedText: (title) => `之前收下的「${title}」`,
      jarTotal: (n) => `罐子里 ${n} 颗`,
      jarWeek: (n) => `这七天 +${n}`,
      jarFirst: "第一颗星进了罐子",
      jarNth: (n) => `罐子里第 ${n} 颗星`,
      demoLink: "先看看演示的一天",
      demoNote: "这是编出来的一天，没有读本机的任何东西。",
      roughTitle: "今天的记录还没打捞",
      overviewRough: (n) => `今天开了 ${n} 段对话`,
      roughTitleDone: (n) => `今天动了 ${n} 个项目`,
      roughKey: "每个小点是你的一次提问。捞一网，看看里面有什么值得留下。",
      // 《诗经·小雅·大东》: the sky has its river of stars, and looking into it there is light.
      epigraph: "维天有汉，鉴亦有光",
      openLib: (w) => `打开${w.library}`,
      asks: (n) => `${n} 次提问`,

      loading: "正在读今天的记录…",
      loadFail: "今天的记录没读出来",
      reload: "再读一次",
      distill: "打捞今天",
      distillAgain: "再捞一遍",
      distillMore: (n) => (n ? `又捞到 ${n} 颗新的` : "这次没捞到新的"),
      refreshNew: (n) => `之后又问了 ${n} 次，再捞一遍`,
      distilling: "正在打捞今天",
      distillingText: (engine) => `${engine} 正在读今天的记录。完整的卡片生成后就会出现，已有内容可以继续看。`,
      distillingStatus: (secs) => `后台打捞中 · 已经 ${secs} 秒，已有内容可以继续看。`,
      previewLabel: "临时结果",
      previewWait: "完成后可收下",
      previewIncomplete: "本轮未完成",
      previewCount: (n) => `已生成 ${n} 颗，查看临时结果`,
      jobLost: "捕捞连接中断，请刷新查看进度；不会自动重试。",
      distillFail: "这一网没捞完",
      retry: "再试一次",
      distillDone: (n) => `捞完了，捞到 ${n} 颗`,
      distillNone: "捞完了，这次没捞到新的",

      notYetText: (engine) => `让${engine} 读一遍今天的记录，把以后还会用到的捞出来。`,
      pasteText: (key) => `今天还没有和 agent 的对话。在网页或别的应用里聊过的，复制下来${key ? `按 ${key}` : "回到这里按 ⌘V"}，也能算进今天。`,
      pasteBtn: "粘贴到今天",
      decidedTitle: "今天的都处理完了",
      nothingTitle: "今天没有要处理的",
      nothingText: "捞过了，没有值得留下的。不是每天都有，明天再来。",

      from: (projects) => `来自 ${projects.join("、")}`,
      usefulWhen: "什么时候用得上",
      skip: "略过",
      copy: "复制",
      savesTo: (p) => `存到 ${p}`,
      change: "换位置",
      prev: "上一条",
      next: "下一条",

      settledHint: "你留下的，和 agent 自己写进笔记、规则、记忆、skill 的，都在这里。",
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
      // Stepping away every so often, and what the stretch before it held.
      restBtn: "歇一歇",
      restOff: "关",
      restIn: (min) => (min > 0 ? `${min} 分钟后` : "快到了"),
      restHead: "休息一下，一百下，都是合法的",
      restLines: ["看看远处，让眼睛歇一歇。", "站起来走两步，倒杯水。", "agent 还在跑，不用盯着它。"],
      restOver: "歇好了",
      recapLoading: "正在回看刚才这一段…",
      recapFailed: "刚才的记录暂时没读到，5 秒后会再试。",
      recapRetry: "现在重试",
      restSkip: "跳过",
      restSnooze: (min) => `再干 ${min} 分钟`,
      restBack: "回去继续",
      restCount: (n) => `今天第 ${n} 次`,
      recapTitle: (min) => `刚才这 ${min} 分钟`,
      recapSum: (asks, things) => `你问了 ${asks} 次，推进了 ${things} 件事`,
      recapWaiting: (n) => `${n} 件在等你回话`,
      recapRunning: (n) => `${n} 件 agent 还在跑`,
      recapCols: { running: "agent 还在跑", waiting: "等你回话", done: "已收尾" },
      recapNone: "这一段没有和 agent 的对话。",
      recapEarlier: "之前交代的",
      recapEmptyCol: "没有",
      recapAsk: "回去之前想一下：接下来最要紧的是哪一件？",
      restSet: "定时歇一歇",
      restEvery: "每隔",
      restFor: "歇",
      restMin: (n) => `${n} 分钟`,
      restOn: "开",
      restNow: "现在就歇",
      restHint: "到点会把这个页面带到前面。歇到最后，给你看刚才这一段你和 agent 各做了什么。",
      restNotifyTitle: "该歇一歇了",
      restNotifyBody: "歇几分钟，回来看看刚才这一段做了什么。",
      restSaved: (min) => `已打开，每 ${min} 分钟歇一次`,
      restStopped: "已关掉定时歇一歇",
      // The calendar under the date.
      calTitle: (y, m) => `${y}年${m}月`,
      calWeek: ["一", "二", "三", "四", "五", "六", "日"],
      calThings: (n) => `${n} 件`,
      calNotYet: "没打捞",
      calOpen: (n) => `${n} 待定`,
      calLoading: "正在查这个月的记录…",
      calTickAll: "全选没打捞的",
      calGo: (n) => (n ? `打捞选中的 ${n} 天` : "先勾选日子"),
      calNote: (engine) => `勾选后由${engine} 逐天打捞；直接点日期是查看那一天。`,
      calTick: (label) => `勾选 ${label}`,
      calPrevMonth: "上个月",
      calNextMonth: "下个月",
      batchText: (n) => `一共 ${n} 天，逐天打捞，可以先去忙别的。`,
      batchStatus: (done, total, label) => `正在打捞第 ${done + 1}/${total} 天：${label}`,
      batchDone: (n, found) => `打捞完了 ${n} 天，捞到 ${found} 颗`,
      batchFailed: (n) => `，${n} 天没有可读的记录`,
      batching: "正在打捞",
      pickDay: "换一天看",
      dayToday: "今天",
      dayThings: (n) => `${n} 件事`,
      dayOpen: (n) => `${n} 条没定`,
      dayNotYet: "还没打捞",
      dayUnseen: "还没看过",
      dayOption: (label, parts) => (parts.length ? `${label}：${parts.join("，")}` : label),
      switching: "正在切换…",
      switchingTo: (label) => `正在读 ${label}的记录`,
      switchingText: "记录多的日子要几秒。看过一次的日子，再切回来就快了。",
      seeYesterday: "看昨天",
      leftFrom: (key, yesterdayKey) => (key === yesterdayKey ? "昨天留下的" : `${dateOf(key).getMonth() + 1}月${dateOf(key).getDate()}日留下的`),
      backToToday: "回到今天",
      agents: (list) => (list.length ? `（${list.map((a) => `${a.name} ${a.sessions}`).join("、")}）` : ""),
      statusDone: (time, projects, sessions, agents, since) =>
        `${time} 打捞过：${projects} 个项目，${sessions} 段对话${agents}${since ? `，之后又问了 ${since} 次` : ""}。`,
      statusFresh: (projects, sessions, agents) => `今天 ${projects} 个项目，${sessions} 段对话${agents}。`,
      demoOnly: "演示里打不开，正式运行时会在浏览器里打开",
      errors: {
        NO_CLI: "这台机器上没找到 claude 或 codex 命令。装上其中一个就行；都装不了的话，在 ~/.dotjar/config.json 的 api 里填一个 OpenAI 兼容的接口。",
        NO_CODEX: "没找到 codex 命令。在终端跑一下 which codex 看装没装，或者点右上角换成 Claude 来打捞。",
        NO_API: "还没配模型接口。在 ~/.dotjar/config.json 的 api 里填 baseUrl 和 model；密钥填 apiKey，或用 apiKeyEnv 指到环境变量。",
        NO_WORK: "今天还没有和 agent 的对话，暂时没什么可打捞的。",
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
      restartFail: "服务没重启起来。在终端重新启动一次 dotjar。",
      libCut: "后面还有，全文在原文件里。",
      libHowTo: (dir) => `在候选卡片上按 ↵，那一条会存成 Markdown 放进 ${dir}，并出现在这里。`,
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
      kinds: { craft: "Craft", strategy: "Strategy", lesson: "Lesson", trap: "Blind spot", note: "Note", rule: "Rule", skill: "Skill", memory: "Memory" },
      kindHints: {
        craft: "how to work with the agent",
        strategy: "a way of going at a kind of problem",
        lesson: "a judgement the work earned",
        trap: "a case that is easy to leave out",
      },
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

      overviewTitle: (n, stars) => `${plural(n, "thing", "things")} today${stars ? `, ${plural(stars, "star", "stars")} caught` : ""}`,
      dotsKey: (kept, open, w, ask) => `<span>${ask}a question of yours</span><span>${open}${w.tabOpen}</span><span>${kept}${w.tabDone}</span>`,
      dotsLoose: (n) => `${n} more, not clearly from any one of these`,
      growthGood: "Done well",
      growthNext: "Next time",
      growthUsed: "Put to use",
      growthRead: "Read this; tuck it away",
      growthUnread: "Show this again",
      growthHidden: (n) => `${n} tucked away · Show`,
      growthCollapse: "Hide the ones you've read",
      growthReadHint: "Checking means you've read this, not that you agree",
      growthLocalOnly: "Tucked away for now; this browser cannot save it for your next visit",
      growthUsedText: (title) => `“${title}”, kept earlier`,
      jarTotal: (n) => `${plural(n, "star", "stars")} in the jar`,
      jarWeek: (n) => `+${n} in seven days`,
      jarFirst: "First star in the jar",
      jarNth: (n) => `Star number ${n} in the jar`,
      demoLink: "See a made-up day first",
      demoNote: "A made-up day. Nothing was read from this machine.",
      roughTitle: "Not gone through yet",
      overviewRough: (n) => `${plural(n, "conversation", "conversations")} today`,
      roughTitleDone: (n) => `${plural(n, "project", "projects")} today`,
      roughKey: "Each speck is a question you asked. Go through the day to see what's worth keeping.",
      epigraph: "The sky has its river of stars; look into it, and it too gives light.",
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
      distillingText: (engine) => `${engine} is reading today's conversations. Complete cards appear as they arrive; existing cards remain available.`,
      distillingStatus: (secs) => `${secs}s · Catching in the background. Existing cards stay available.`,
      previewLabel: "Provisional",
      previewWait: "Keep after completion",
      previewIncomplete: "Run incomplete",
      previewCount: (n) => `${n} ready to preview`,
      jobLost: "Connection lost. Reload to check progress; no automatic retry.",
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
      nothingText: "Went through it and found nothing worth keeping. Some days are like that; come back tomorrow.",

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
      restBtn: "Breaks",
      restOff: "off",
      restIn: (min) => (min > 0 ? `in ${min} min` : "any minute"),
      restHead: "Take a break. Take a hundred. All allowed.",
      restLines: ["Look at something far off and rest your eyes.", "Stand up, walk a little, get some water.", "The agent is still running. It does not need watching."],
      restOver: "Rested",
      recapLoading: "Looking back at the last stretch…",
      recapFailed: "Could not read the recent records. Retrying in 5 seconds.",
      recapRetry: "Retry now",
      restSkip: "Skip",
      restSnooze: (min) => `${min} more minutes`,
      restBack: "Back to it",
      restCount: (n) => `Break ${n} today`,
      recapTitle: (min) => `The last ${min} minutes`,
      recapSum: (asks, things) => `You asked ${plural(asks, "time", "times")} and moved ${plural(things, "thing", "things")} along`,
      recapWaiting: (n) => `${n} waiting on you`,
      recapRunning: (n) => `${n} still running`,
      recapCols: { running: "Agent still running", waiting: "Waiting on you", done: "Wrapped up" },
      recapNone: "No work with an agent in this stretch.",
      recapEarlier: "asked earlier",
      recapEmptyCol: "none",
      recapAsk: "Before going back: which of these matters most next?",
      restSet: "Timed breaks",
      restEvery: "Every",
      restFor: "For",
      restMin: (n) => `${n} min`,
      restOn: "On",
      restNow: "Take one now",
      restHint: "When it is time, this page comes to the front. Near the end of the break it shows what you and the agents did in the stretch before it.",
      restNotifyTitle: "Time for a break",
      restNotifyBody: "Step away for a few minutes, then see what the last stretch held.",
      restSaved: (min) => `On: a break every ${min} minutes`,
      restStopped: "Timed breaks are off",
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
      switchingTo: (label) => `Reading ${label}`,
      switchingText: "A busy day takes a few seconds. A day you have already looked at opens faster the next time.",
      seeYesterday: "See yesterday",
      leftFrom: (key, yesterdayKey) => (key === yesterdayKey ? "left from yesterday" : `left from ${MONTH_EN[dateOf(key).getMonth()]} ${dateOf(key).getDate()}`),
      backToToday: "Back to today",
      agents: (list) => (list.length ? ` (${list.map((a) => `${a.name} ${a.sessions}`).join(", ")})` : ""),
      statusDone: (time, projects, sessions, agents, since) =>
        `Went through at ${time}: ${plural(projects, "project", "projects")}, ${plural(sessions, "conversation", "conversations")}${agents}${since ? `, ${plural(since, "ask", "asks")} since` : ""}.`,
      statusFresh: (projects, sessions, agents) => `${plural(projects, "project", "projects")}, ${plural(sessions, "conversation", "conversations")} today${agents}.`,
      demoOnly: "Not available in the demo. In the real app this opens in your browser.",
      errors: {
        NO_CLI: "Couldn't find a claude or codex command on this machine. Install either one. If you can't, fill in an OpenAI-compatible endpoint under api in ~/.dotjar/config.json.",
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
      restartFail: "The server did not come back. Start dotjar again from a terminal.",
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
