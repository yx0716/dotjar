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
          kind: "craft",
          task: 3,
          title: "一句「加个缓存」让 agent 猜了范围，先说慢在哪、怎样算好",
          payoff: "下次交代一件性能上的事时",
          projects: ["web/console"],
          draft: [
            "**今天这一幕**：15:50 你说「控制台列表太慢了，加个缓存」。agent 给整个列表接口加了一层 60 秒的缓存，命中率 91%。你又回了两次「不对，慢的是带筛选的查询」才对上，前后四轮。",
            "",
            "**下次这样说**：",
            "",
            "> 控制台列表里带筛选条件的查询要 3 秒以上，目标是降到 500 毫秒以内。先别动手：告诉我你打算缓存哪一类请求、怎么量效果，我确认了再改。",
            "",
            "**为什么管用**：agent 缺的是「慢的是哪一类」和「怎样算好」。没有这两样，它只能挑最容易命中的地方下手。",
            "",
            "**一劳永逸**：性能上的事每次都要这两句，可以在 `CLAUDE.md` 里加一行：`性能优化先给基线数字和目标数字，再提方案，等确认后动手。`",
          ].join("\n"),
        },
        {
          id: "demo-2",
          kind: "lesson",
          task: 0,
          title: "幂等键要由调用方生成，服务端生成的键挡不住重试",
          payoff: "再设计会被客户端重试的写接口时",
          projects: ["billing/ledger", "gateway"],
          draft: [
            "**发生了什么**：账本服务明明给每个请求都分了 `request_id` 去重，同一笔钱还是扣了两次。",
            "",
            "**原来是这样**：重试发生在调用方没等到响应的时候。它不知道服务端处理了没有，手里稳定的只有自己发出去的东西。",
            "",
            "网关 3 秒超时 → 重发 `POST /charges` → 账本给第二次请求又分了一个新 `request_id` → 去重表里两个键谁也查不到谁 → 两笔都入账。",
            "",
            "改成客户端生成 `Idempotency-Key`、账本按键做唯一约束之后，压测里 2000 次带超时的重试只落了 2000 笔。",
            "",
            "**下次再遇到**：听到「我们有去重」时，先问去重的键是谁生成的、重试时会不会变。",
            "",
            "**边界**：键只管「同一个意图」。用户改了金额再点一次是新意图，得换键。键还要有保留期，过期后同键再来应该报错，不能重新执行。",
          ].join("\n"),
        },
        {
          id: "demo-3",
          kind: "strategy",
          task: 2,
          title: "排查「本地能过、CI 不过」可以固定成四步",
          payoff: "下次测试只在 CI 上挂的时候",
          projects: ["gateway"],
          draft: [
            "**什么时候用**：同一个提交，本地测试全过，CI 上稳定挂或者偶尔挂。",
            "",
            "**怎么做**：",
            "1. 对一遍运行环境：语言版本、时区、区域设置、CPU 核数。用 CI 的镜像在本地起一次。",
            "2. 把测试顺序固定成 CI 的顺序再跑，排掉测试之间的隐式依赖。",
            "3. 找共享的东西：临时目录、端口、全局单例、没清掉的数据库行。",
            "4. 偶尔挂的，重复跑 50 次数失败率，看改动前后是不是真的变了。",
            "",
            "**今天是怎么走的**：先分环境差异还是共享状态，是你定的；agent 用 CI 镜像重跑了 50 次，问题落在第 3 步，两个用例共用了一个临时目录。",
            "",
            "**什么时候不灵**：失败和外部服务有关（限流、网络抖动）时，这四步都查不到，要先看 CI 那一侧的日志。",
          ].join("\n"),
        },
        {
          id: "demo-4",
          kind: "trap",
          task: 0,
          title: "幂等只在单实例上压过，两个实例同时收到同一个键没验过",
          payoff: "再听到「压测过了」时",
          projects: ["billing/ledger"],
          draft: [
            "**漏了什么**：今天 2000 次重试的压测跑在单实例上。两个实例同时收到同一个 `Idempotency-Key` 时，谁先写入、另一个怎么返回，没人验过。agent 的收尾写的是「压测通过」，你也没问跑在几个实例上。还没验证。",
            "",
            "**为什么容易漏**：复现用的是单机脚本，修好之后顺手拿同一个脚本当了验收。验证的环境跟着复现的环境走，比线上少了一维。",
            "",
            "**下次问这一句**：",
            "",
            "> 这次验证跑的环境，和线上比少了什么？",
            "",
            "**同类还有**：只在空库上跑过的迁移；只用一个时区测过的定时任务。",
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
      // Kept earlier in the made-up day, so the river shows both kinds of star.
      keptEarlier: [
        { kind: "lesson", title: "退避间隔要加随机抖动", task: 0 },
        { kind: "craft", title: "写迁移前先让 agent 给出回滚语句", task: 1 },
        { kind: "strategy", title: "发布说明只写用户能感知的变化", task: 4 },
      ],
      growth: {
        highlight: "账本迁移你坚持先加可空列再收紧约束，线上副本这次没有报错",
        next: "交代性能上的事，先给基线数字和目标数字",
        applied: [{ title: "迁移脚本里不许直接删列", how: "拦下了 agent 写的那条删列语句", file: "" }],
      },
      // What the stretch before a rest held.
      recap: {
        from: "15:50",
        to: "16:40",
        minutes: 50,
        asks: 12,
        more: 0,
        running: 1,
        waiting: 1,
        done: 2,
        things: [
          { title: "控制台查询慢", project: "console", agent: "Claude Code", asks: 5, from: "15:52", to: "16:31", ask: "控制台列表太慢了，加个缓存", latest: "命中率 91%，库的耗时怎么没降", reply: "按耗时加权后命中率只有 11%。要不要改成只缓存带筛选的查询？", state: "waiting", marks: [0.04, 0.2, 0.38, 0.6, 0.82] },
          { title: "账本对账脚本", project: "ledger", agent: "Codex", asks: 3, from: "16:05", to: "16:35", ask: "把上周的流水和余额对一遍，列出对不上的", latest: "只看 3 月 11 日之后的", reply: "", state: "running", marks: [0.3, 0.52, 0.9] },
          { title: "发布说明", project: "console", agent: "Claude Code", asks: 3, from: "15:55", to: "16:13", ask: "从这周的合并记录生成发布说明初稿", latest: "去掉内部重构那几条", reply: "初稿已写入 docs/release-0.9.md，共 6 条用户能感知的变化。", state: "done", marks: [0.1, 0.24, 0.46] },
          { title: "CI 偶发失败", project: "gateway", agent: "Cursor", asks: 1, from: "16:25", to: "16:28", ask: "把重跑 50 次的结果汇总成表", latest: "", reply: "50 次全部通过，表格放在 PR 描述里了。", state: "done", marks: [0.7] },
        ],
      },
    },

    en: {
      candidates: [
        {
          id: "demo-1",
          kind: "craft",
          task: 3,
          title: "“Add a cache” left the agent guessing; say what is slow and what counts as fixed",
          payoff: "the next time you hand over a performance problem",
          projects: ["web/console"],
          draft: [
            "**What happened**: At 15:50 you said “the console list is too slow, add a cache.” The agent put a 60-second cache on the whole list endpoint and reported a 91% hit rate. It took two more rounds of “no, the slow part is the filtered queries” to line up. Four rounds in all.",
            "",
            "**Next time, say**:",
            "",
            "> Filtered queries on the console list take over 3 seconds; the goal is under 500 ms. Don't change anything yet: tell me which requests you would cache and how you'd measure it, and I'll confirm.",
            "",
            "**Why it works**: The agent was missing which requests were slow and what counted as fixed. Without those it went for whatever was easiest to hit.",
            "",
            "**Make it stick**: Performance work needs these two lines every time. One line in `CLAUDE.md` covers it: `For performance work, give a baseline and a target first, then a plan, and wait for a yes.`",
          ].join("\n"),
        },
        {
          id: "demo-2",
          kind: "lesson",
          task: 0,
          title: "The caller has to make the idempotency key; one the server makes can't stop a retry",
          payoff: "designing a write endpoint that clients will retry",
          projects: ["billing/ledger", "gateway"],
          draft: [
            "**What happened**: The ledger gave every request a `request_id` to dedupe on, and the same charge still went through twice.",
            "",
            "**What's going on**: Retries happen when the caller never got a response. It can't tell whether the server handled the request, so the only stable thing it has is what it sent.",
            "",
            "Gateway times out at 3 s → re-sends `POST /charges` → the ledger gives the second request a new `request_id` → neither key finds the other in the dedupe table → both are booked.",
            "",
            "With a client-generated `Idempotency-Key` and a unique constraint on it, 2,000 retried requests in the load test produced exactly 2,000 charges.",
            "",
            "**Next time**: When someone says “we dedupe”, ask who generates the key and whether it changes on a retry.",
            "",
            "**Limits**: A key covers one intent. If the user changes the amount and clicks again, that is a new intent and needs a new key. Keys also need a retention period; a request with an expired key should fail, not run again.",
          ].join("\n"),
        },
        {
          id: "demo-3",
          kind: "strategy",
          task: 2,
          title: "“Passes locally, fails in CI” comes down to four checks",
          payoff: "the next time a test only fails in CI",
          projects: ["gateway"],
          draft: [
            "**When**: Same commit, tests pass locally, and CI fails every time or some of the time.",
            "",
            "**Steps**:",
            "1. Compare the environments: language version, time zone, locale, CPU count. Run once locally in the CI image.",
            "2. Run the tests in CI's order to rule out tests that depend on each other.",
            "3. Look for shared things: temp folders, ports, global singletons, database rows nobody cleaned up.",
            "4. For flaky failures, run 50 times and count, so you know whether a change really moved the failure rate.",
            "",
            "**Today's run**: Splitting environment drift from shared state was your call. The agent re-ran 50 times in the CI image, and it landed on step 3: two tests shared a temp folder.",
            "",
            "**When it fails**: If the failure involves an outside service (rate limits, a flaky network), none of the four finds it. Start from the logs on the CI side.",
          ].join("\n"),
        },
        {
          id: "demo-4",
          kind: "trap",
          task: 0,
          title: "Idempotency was load-tested on one instance; two instances getting the same key was never tried",
          payoff: "the next time you hear “the load test passed”",
          projects: ["billing/ledger"],
          draft: [
            "**What was missed**: Today's 2,000-retry load test ran against a single instance. What happens when two instances receive the same `Idempotency-Key` at once, which one writes and what the other returns, was never checked. The agent's closing message said “load test passed” and you did not ask how many instances it ran on. Not verified yet.",
            "",
            "**Why it's easy to miss**: The reproduction was a single-machine script, and once the fix was in, the same script became the acceptance test. The check inherited the reproduction's environment, one dimension short of production.",
            "",
            "**Ask this next time**:",
            "",
            "> What does the environment this was verified in lack, compared with production?",
            "",
            "**Also watch for**: Migrations only ever run on an empty database; scheduled jobs only tested in one time zone.",
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
        { kind: "lesson", title: "Add random jitter to retry backoff", task: 0 },
        { kind: "craft", title: "Have the agent write the rollback before the migration", task: 1 },
        { kind: "strategy", title: "Release notes cover only what users notice", task: 4 },
      ],
      growth: {
        highlight: "On the ledger migration you held out for nullable first, constraint later, and the live replica did not error this time",
        next: "For performance work, give a baseline and a target up front",
        applied: [{ title: "Migrations never drop a column directly", how: "it stopped the agent's DROP COLUMN", file: "" }],
      },
      recap: {
        from: "15:50",
        to: "16:40",
        minutes: 50,
        asks: 12,
        more: 0,
        running: 1,
        waiting: 1,
        done: 2,
        things: [
          { title: "Slow console queries", project: "console", agent: "Claude Code", asks: 5, from: "15:52", to: "16:31", ask: "The console list is too slow, add a cache", latest: "91% hit rate, so why is database time flat", reply: "Weighted by query time the hit rate is 11%. Should I cache only the filtered queries instead?", state: "waiting", marks: [0.04, 0.2, 0.38, 0.6, 0.82] },
          { title: "Ledger reconciliation script", project: "ledger", agent: "Codex", asks: 3, from: "16:05", to: "16:35", ask: "Reconcile last week's journal against balances and list what is off", latest: "Only from March 11 on", reply: "", state: "running", marks: [0.3, 0.52, 0.9] },
          { title: "Release notes", project: "console", agent: "Claude Code", asks: 3, from: "15:55", to: "16:13", ask: "Draft release notes from this week's merge log", latest: "Drop the internal refactors", reply: "Draft is in docs/release-0.9.md: six changes users will notice.", state: "done", marks: [0.1, 0.24, 0.46] },
          { title: "Flaky CI", project: "gateway", agent: "Cursor", asks: 1, from: "16:25", to: "16:28", ask: "Put the 50 re-runs into a table", latest: "", reply: "All 50 passed; the table is in the PR description.", state: "done", marks: [0.7] },
        ],
      },
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
        growth: distilledAt ? data.growth : null,
        // A jar that already holds a few weeks of keepers.
        jar: { total: 38 + data.keptEarlier.length + kept.length, week: 6 + kept.length, days: 17 },
        // Each candidate says which task it came from.
        dots: distilledAt
          ? [
              ...items.map((c) => ({ id: c.id, kind: c.kind, title: c.title, status: c.status, file: "", task: c.task })),
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

    // A rest to try out: short, and what it looks back on is made up like the
    // rest of the day. `?state=resting` opens on one just begun, `?state=rest`
    // on one in its last minute, with the look back showing.
    const rest = { enabled: scene === "rest" || scene === "resting", everyMin: 50, forMin: 5, phase: "idle", startedAt: 0, endsAt: 0, count: 2 };
    const beginRest = (elapsed, left) => Object.assign(rest, { phase: "resting", startedAt: Date.now() - elapsed, endsAt: Date.now() + left });
    if (scene === "rest") beginRest(252000, 48000);
    if (scene === "rested") beginRest(300000, -1000);
    if (scene === "resting") beginRest(39000, 261000);
    const restStatus = () =>
      Promise.resolve({
        enabled: rest.enabled,
        everyMin: rest.everyMin,
        forMin: rest.forMin,
        choices: { every: [25, 50, 90], for: [3, 5, 10] },
        phase: rest.phase,
        now: Date.now(),
        startedAt: rest.startedAt,
        endsAt: rest.endsAt,
        dueAt: rest.enabled && rest.phase === "idle" ? Date.now() + 32 * 60000 : 0,
        count: rest.count,
      });
    const endRest = (counted) => {
      if (rest.phase === "resting" && counted) rest.count++;
      rest.phase = "idle";
      return restStatus();
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
      rest: restStatus,
      restRecap: () => Promise.resolve(rest.phase === "resting" ? data.recap : null),
      // Forty seconds rather than five minutes, so the whole of it can be seen.
      restStart: () => (beginRest(0, 40000), restStatus()),
      restSkip: () => endRest(false),
      restSnooze: () => endRest(false),
      restDone: () => endRest(true),
      setRest: (patch) => (Object.assign(rest, patch || {}), restStatus()),
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
