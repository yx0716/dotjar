"use strict";

// A made-up day, in Chinese and in English, used by `npm run demo`, by
// screenshots, and when the overlay is opened as a plain file. Nothing here
// is read from the machine.

(function (root) {
  const DAY = "2026-03-18";

  const DATA = {
    zh: {
      candidates: [
        {
          id: "demo-1",
          kind: "note",
          title: "幂等键要由调用方生成，服务端生成的键挡不住重试",
          payoff: "再设计会被客户端重试的写接口时",
          projects: ["billing/ledger", "gateway"],
          draft: [
            "**核心结论**：幂等键得在请求发出去之前由调用方生成，每次重试原样带上。服务端收到请求再生成的键，只能给这一次请求去重，挡不住超时后的第二次。",
            "",
            "**为什么**：重试都发生在调用方没等到响应的时候。它不知道服务端处理了没有，手里稳定的只有自己发出去的东西。键如果由服务端分配，两次请求拿到两个键，去重表里谁也查不到谁。",
            "",
            "**例子**：今天的重复扣款就是这么来的。网关 3 秒超时后重发 `POST /charges`，账本服务给两次请求各分了一个 `request_id`，两笔都入了账。改成客户端生成 `Idempotency-Key`、账本按键做唯一约束之后，压测里 2000 次带超时的重试只落了 2000 笔。",
            "",
            "**边界**：键只管「同一个意图」。用户改了金额再点一次是新意图，得换键，不然第二次会被当成重试吞掉。键还要有保留期，过期后同键再来应该报错，不能重新执行。",
          ].join("\n"),
        },
        {
          id: "demo-2",
          kind: "rule",
          title: "改数据库结构前先给出回滚语句，再动手",
          payoff: "任何要写迁移脚本的任务开头",
          projects: ["billing/ledger"],
          draft: [
            "写迁移之前，先把回滚语句写出来给我看，我确认了再跑正向迁移。",
            "",
            "**Why**：今天 agent 直接跑了加非空列的迁移，线上副本因为旧代码写不进去报错，临时补回滚花了四十分钟。回滚留到事后补，都是在最慌的时候补。",
            "",
            "**How to apply**：",
            "1. 每个迁移文件同时有 `up` 和 `down`，先写 `down`。",
            "2. 加列分两步：先加可空列并回填，下个版本再收紧约束。",
            "3. 回不去的变更（删列、改类型）先说，等我点头。",
          ].join("\n"),
        },
        {
          id: "demo-3",
          kind: "skill",
          title: "排查「本地能过、CI 不过」可以固定成四步",
          payoff: "下次测试只在 CI 上挂的时候",
          projects: ["gateway", "web/console"],
          draft: [
            "**触发条件**：同一个提交，本地测试全过，CI 上稳定挂或者偶尔挂。",
            "",
            "**步骤**：",
            "1. 对一遍运行环境：语言版本、时区、区域设置、CPU 核数。用 CI 的镜像在本地起一次。",
            "2. 把测试顺序固定成 CI 的顺序再跑，排掉测试之间的隐式依赖。",
            "3. 找共享的东西：临时目录、端口、全局单例、没清掉的数据库行。",
            "4. 偶尔挂的，重复跑 50 次数失败率，看改动前后是不是真的变了。",
            "",
            "**验收**：说得出失败属于哪一步，而且同一条命令在本地用 CI 镜像能稳定复现。",
          ].join("\n"),
        },
        {
          id: "demo-4",
          kind: "note",
          title: "缓存命中率高不代表缓存有用，要看挡掉的是不是贵的请求",
          payoff: "再评估要不要加一层缓存时",
          projects: ["web/console"],
          draft: [
            "**核心结论**：命中率数的是请求个数，不是省下的开销。一层缓存有没有用，得按「命中的请求原本要花多少」来算。",
            "",
            "**为什么**：便宜的请求最密，也最容易命中。真正贵的长尾查询参数很散，几乎不命中。于是命中率很好看，后端负载基本没动。",
            "",
            "**例子**：控制台的列表接口命中率 91%，数据库耗时只降了 6%。按耗时加权之后命中率只有 11%，挡掉的全是本来就只要 2 毫秒的查询。",
            "",
            "**边界**：瓶颈如果是连接数而不是计算量，挡掉一大批便宜请求还是值的。这条只针对为了省计算而加的缓存。",
          ].join("\n"),
        },
      ],
      settled: [
        { kind: "note", name: "重试与退避", title: "退避要加抖动，不然重试会凑成新的洪峰", more: 1, where: "工程/可靠性", isNew: false },
        { kind: "note", name: "账本对账设计", title: "对账看流水，余额只是流水的缓存", more: 0, where: "工程/支付", isNew: true },
        { kind: "rule", name: "CLAUDE.md", title: "提交前跑受影响模块的测试，别只跑改的那个文件", more: 0, where: "billing/ledger", isNew: false },
        { kind: "memory", name: "偏好简短的提交说明", title: "提交说明写原因，不用复述改了什么", more: 0, where: "ledger", isNew: true },
        { kind: "skill", name: "release-notes", title: "从合并记录生成发布说明", more: 2, where: "release-notes", isNew: false },
      ],
      tasks: [
        { title: "重复扣款排查", effort: 5, human: "定幂等键该由谁生成", ai: "复现超时重试、写压测", doubt: "压测只覆盖了单实例", share: "high", from: "10:10", to: "12:20" },
        { title: "账本迁移", effort: 4, human: "决定先加可空列再收紧约束", ai: "写迁移脚本和回滚语句", share: "mid", from: "13:40", to: "15:30" },
        { title: "CI 偶发失败", effort: 3, human: "分清是环境差异还是共享状态", ai: "用 CI 镜像在本地重跑 50 次", doubt: "50 次全过不等于修好了", share: "mid", from: "09:15", to: "10:00" },
        { title: "控制台缓存", effort: 2, human: "看出命中率不等于省下的开销", ai: "加缓存层、统计耗时", share: "high", from: "15:50", to: "16:55" },
        { title: "发布说明", effort: 1, human: "挑哪些改动值得告诉用户", ai: "从合并记录生成初稿", share: "low", from: "17:20", to: "17:40" },
      ],
      depositDir: "~/笔记/收件箱",
      // Kept earlier in the made-up day, so the stream shows both kinds of dot.
      keptEarlier: [
        { kind: "note", title: "退避间隔要加随机抖动", task: 0 },
        { kind: "rule", title: "迁移脚本里不许直接删列", task: 1 },
        { kind: "memory", title: "发布说明只写用户能感知的变化", task: 4 },
      ],
    },

    en: {
      candidates: [
        {
          id: "demo-1",
          kind: "note",
          title: "The caller has to make the idempotency key; one the server makes can't stop a retry",
          payoff: "designing a write endpoint that clients will retry",
          projects: ["billing/ledger", "gateway"],
          draft: [
            "**Takeaway**: The caller has to generate the idempotency key before sending the request, and send the same key on every retry. A key the server generates after receiving the request only dedupes that one request. It does nothing about the second one that arrives after a timeout.",
            "",
            "**Why**: Retries happen when the caller never got a response. It can't tell whether the server handled the request, so the only stable thing it has is what it sent. If the server hands out the key, two requests get two keys and neither finds the other in the dedupe table.",
            "",
            "**Example**: That is how today's double charge happened. The gateway timed out at 3 seconds and re-sent `POST /charges`, the ledger gave each request its own `request_id`, and both were booked. With a client-generated `Idempotency-Key` and a unique constraint on it, 2,000 retried requests in the load test produced exactly 2,000 charges.",
            "",
            "**Limits**: A key covers one intent. If the user changes the amount and clicks again, that is a new intent and needs a new key, or the second attempt gets swallowed as a retry. Keys also need a retention period; a request with an expired key should fail, not run again.",
          ].join("\n"),
        },
        {
          id: "demo-2",
          kind: "rule",
          title: "Show me the rollback before touching the schema",
          payoff: "the start of any task that writes a migration",
          projects: ["billing/ledger"],
          draft: [
            "Before writing a migration, write the rollback and show it to me. Run the forward migration only after I say yes.",
            "",
            "**Why**: Today the agent ran a migration adding a NOT NULL column. The live replica started failing because the old code couldn't write to it, and putting a rollback together on the spot took forty minutes. A rollback written afterwards gets written in a panic.",
            "",
            "**How to apply**:",
            "1. Every migration file has both `up` and `down`. Write `down` first.",
            "2. Add columns in two steps: nullable with a backfill now, tighten the constraint next release.",
            "3. For changes that can't be undone (dropping a column, changing a type), say so and wait for me.",
          ].join("\n"),
        },
        {
          id: "demo-3",
          kind: "skill",
          title: "“Passes locally, fails in CI” comes down to four checks",
          payoff: "the next time a test only fails in CI",
          projects: ["gateway", "web/console"],
          draft: [
            "**When**: Same commit, tests pass locally, and CI fails every time or some of the time.",
            "",
            "**Steps**:",
            "1. Compare the environments: language version, time zone, locale, CPU count. Run once locally in the CI image.",
            "2. Run the tests in CI's order to rule out tests that depend on each other.",
            "3. Look for shared things: temp folders, ports, global singletons, database rows nobody cleaned up.",
            "4. For flaky failures, run 50 times and count, so you know whether a change really moved the failure rate.",
            "",
            "**Done when**: You can say which step the failure belongs to, and one command reproduces it locally in the CI image.",
          ].join("\n"),
        },
        {
          id: "demo-4",
          kind: "note",
          title: "A high hit rate doesn't mean the cache is helping; check whether the hits were expensive",
          payoff: "deciding whether to add another cache",
          projects: ["web/console"],
          draft: [
            "**Takeaway**: Hit rate counts requests, not cost saved. Whether a cache earns its place depends on what the requests it catches would have cost.",
            "",
            "**Why**: Cheap requests are the most frequent and the easiest to hit. The expensive long-tail queries have scattered parameters and almost never hit. So the hit rate looks great while the backend load barely moves.",
            "",
            "**Example**: The console's list endpoint had a 91% hit rate, and database time dropped 6%. Weighted by query time the hit rate was 11%. Everything it caught was a query that took 2 ms anyway.",
            "",
            "**Limits**: If the bottleneck is connections rather than compute, catching a lot of cheap requests is still worth it. This is about caches added to save compute.",
          ].join("\n"),
        },
      ],
      settled: [
        { kind: "note", name: "Retries and backoff", title: "Add jitter to backoff, or the retries line up into a new spike", more: 1, where: "eng/reliability", isNew: false },
        { kind: "note", name: "Ledger reconciliation", title: "Reconcile against the journal; a balance is just a cache of it", more: 0, where: "eng/payments", isNew: true },
        { kind: "rule", name: "CLAUDE.md", title: "Run the tests for every module the change touches, not just the edited file", more: 0, where: "billing/ledger", isNew: false },
        { kind: "memory", name: "Prefers short commit messages", title: "Commit messages say why, not what changed", more: 0, where: "ledger", isNew: true },
        { kind: "skill", name: "release-notes", title: "Draft release notes from the merge log", more: 2, where: "release-notes", isNew: false },
      ],
      tasks: [
        { title: "Double charge", effort: 5, human: "Decided who makes the idempotency key", ai: "Reproduced the retry, wrote the load test", doubt: "The load test ran on one instance only", share: "high", from: "10:10", to: "12:20" },
        { title: "Ledger migration", effort: 4, human: "Chose nullable first, constraint later", ai: "Wrote the migration and the rollback", share: "mid", from: "13:40", to: "15:30" },
        { title: "Flaky CI", effort: 3, human: "Told environment drift from shared state", ai: "Re-ran 50 times in the CI image", doubt: "50 green runs isn't a fix", share: "mid", from: "09:15", to: "10:00" },
        { title: "Console cache", effort: 2, human: "Saw that hit rate isn't cost saved", ai: "Added the cache, measured query time", share: "high", from: "15:50", to: "16:55" },
        { title: "Release notes", effort: 1, human: "Picked what users need to hear", ai: "Drafted from the merge log", share: "low", from: "17:20", to: "17:40" },
      ],
      depositDir: "~/notes/inbox",
      keptEarlier: [
        { kind: "note", title: "Add random jitter to retry backoff", task: 0 },
        { kind: "rule", title: "Migrations never drop a column directly", task: 1 },
        { kind: "memory", title: "Release notes cover only what users notice", task: 4 },
      ],
    },
  };

  // Before the day is gone through there is no split yet, only where the asking went.
  // Before the made-up day is gone through: its conversations, by name.
  const ROUGH = {
    zh: [
      { title: "支付重复扣款", project: "gateway", asks: 14, from: "10:10", to: "12:20" },
      { title: "账本加列迁移", project: "ledger", asks: 11, from: "13:40", to: "15:30" },
      { title: "控制台查询慢", project: "console", asks: 7, from: "15:50", to: "16:55" },
      { title: "CI 时好时坏", project: "gateway", asks: 6, from: "09:15", to: "10:00" },
      { title: "写这周的发布说明", project: "console", asks: 3, from: "17:20", to: "17:40" },
    ],
    en: [
      { title: "Charged twice", project: "gateway", asks: 14, from: "10:10", to: "12:20" },
      { title: "Add a column to the ledger", project: "ledger", asks: 11, from: "13:40", to: "15:30" },
      { title: "Slow console queries", project: "console", asks: 7, from: "15:50", to: "16:55" },
      { title: "CI passes, then fails", project: "gateway", asks: 6, from: "09:15", to: "10:00" },
      { title: "This week's release notes", project: "console", asks: 3, from: "17:20", to: "17:40" },
    ],
  };
  const rough = (lang) =>
    ROUGH[lang].map((t) => ({ ...t, effort: Math.max(1, Math.round((t.asks / 14) * 5)), human: "", ai: "", share: "" }));

  // How many times something was asked in each half hour of the made-up day.
  const ACTIVITY = { from: "09:00", to: "18:00", bins: [2, 3, 1, 3, 5, 6, 4, 0, 1, 1, 4, 5, 3, 2, 3, 2, 3, 1] };

  const AGENTS = [
    { id: "claude-code", name: "Claude Code", sessions: 5 },
    { id: "codex", name: "Codex", sessions: 3 },
    { id: "cursor", name: "Cursor", sessions: 1 },
  ];

  function createBridge(host) {
    const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
    const wantLang = params.get("lang") || (typeof navigator !== "undefined" ? navigator.language : "zh");
    const lang = String(wantLang).toLowerCase().startsWith("en") ? "en" : "zh";
    const data = DATA[lang];
    const scene = params.get("state") || "";
    const items = data.candidates.map((c, n) => ({ ...c, status: scene === "decided" ? (n === 1 ? "skipped" : "kept") : "open" }));
    let distilledAt = scene === "fresh" ? null : new Date(2026, 2, 18, 17, 42).getTime();

    function view() {
      const kept = items.filter((i) => i.status === "kept");
      return {
        day: DAY,
        todayKey: DAY,
        daysBack: 0,
        days: [
          { day: DAY, seen: true, things: 5, open: items.filter((i) => i.status === "open").length, distilled: Boolean(distilledAt) },
          { day: "2026-03-17", seen: true, things: 4, open: 0, distilled: true },
          { day: "2026-03-16", seen: true, things: 3, open: 1, distilled: true },
          { day: "2026-03-15", seen: false, things: 0, open: 0, distilled: false },
          { day: "2026-03-14", seen: true, things: 0, open: 0, distilled: false },
        ],
        stats: { sessions: 9, turns: 41, projects: 3, agents: AGENTS },
        distilledAt,
        model: "demo",
        turnsSince: 0,
        candidates: distilledAt ? items.filter((i) => i.status === "open") : [],
        kept: kept.map((k) => ({ ...k, fileLabel: `${data.depositDir}/${k.title}.md` })),
        skipped: items.filter((i) => i.status === "skipped").length,
        settled: data.settled,
        tasks: distilledAt ? data.tasks : rough(lang),
        tasksAreRough: !distilledAt,
        activity: ACTIVITY,
        // Each candidate came from the task in the same place in the list.
        dots: distilledAt
          ? [
              ...items.map((c, n) => ({ id: c.id, kind: c.kind, title: c.title, status: c.status, file: "", task: n })),
              ...data.keptEarlier.map((k, n) => ({ ...k, id: `demo-kept-${n}`, status: "kept", file: "" })),
            ]
          : [],
        history: [],
        depositDir: data.depositDir,
        hotkey: "Alt+Shift+S",
      };
    }

    const set = (id, status) => {
      const item = items.find((i) => i.id === id);
      if (item) item.status = status;
      return Promise.resolve(view());
    };

    let engine = "claude-cli";
    const engineInfo = () => ({ engine, engineModel: "", engines: [{ id: "claude-cli", available: true }, { id: "codex-cli", available: true }, { id: "openai", available: false, model: "" }] });

    function demoOnly() {
      const err = new Error("demo");
      err.code = "DEMO_ONLY";
      return Promise.reject(err);
    }

    return {
      demo: true,
      meta: () =>
        Promise.resolve({ demo: true, ...engineInfo(), hotkey: "Alt+Shift+S", captureHotkey: "Alt+Shift+C", mac: true, wording: params.get("words") || "", language: lang }),
      today: () => Promise.resolve(view()),
      distilling: () => Promise.resolve(scene === "distilling"),
      calendar: (month) => {
        const [y, m] = month.split("-").map(Number);
        const asks = { 2: 14, 3: 22, 4: 9, 6: 3, 9: 31, 10: 18, 11: 26, 12: 7, 13: 12, 16: 24, 17: 19, 18: 41 };
        const done = { 9: 4, 11: 3, 16: 3, 17: 4, 18: 5 };
        const days = [];
        for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) {
          const key = `${month}-${String(d).padStart(2, "0")}`;
          const here = month === DAY.slice(0, 7);
          days.push({ day: key, future: key > DAY, asks: here ? asks[d] || 0 : (d * 7) % 5 ? 0 : 6, seen: Boolean(here && done[d]), things: here ? done[d] || 0 : 0, open: here && d === 16 ? 1 : 0, distilled: Boolean(here && done[d]) });
        }
        return new Promise((resolve) => setTimeout(() => resolve({ month, todayKey: DAY, days }), 250));
      },
      setEngine: (id) => {
        engine = id;
        return Promise.resolve(engineInfo());
      },
      distill: (days) =>
        new Promise((resolve) =>
          setTimeout(() => {
            distilledAt = Date.now();
            resolve({ view: view(), found: items.filter((i) => i.status === "open").length, days: days ? days.length : 1, failed: [] });
          }, 2600)
        ),
      keep: (id) => set(id, "kept"),
      skip: (id) => set(id, "skipped"),
      reopen: (id) => set(id, "open"),
      copy: (text) => (navigator.clipboard ? navigator.clipboard.writeText(text).catch(() => {}) : Promise.resolve()),
      paste: () => Promise.resolve(view()),
      chooseDepositDir: () => Promise.resolve(view()),
      reveal: () => Promise.resolve(true),
      library: demoOnly,
      hide: () => (host && host.hide ? host.hide() : Promise.resolve(true)),
      onShown: (fn) => host && host.onShown && host.onShown(fn),
      onCaptured: () => {},
    };
  }

  root.DotjarDemo = { createBridge, DATA };
})(typeof window !== "undefined" ? window : globalThis);
