"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DOTJAR_HOME = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "dotjar-distill-usage-"));

const d = require("../src/core/distill");

test("JSON is recovered from the shapes models actually return", () => {
  assert.deepEqual(d.extractJson('{"items":[]}'), { items: [] });
  assert.deepEqual(d.extractJson('```json\n{"items":[1]}\n```'), { items: [1] });
  assert.deepEqual(d.extractJson('好的，结果如下：\n{"items":[2]}\n以上。'), { items: [2] });
  assert.throws(() => d.extractJson("我没有找到值得留下的内容"), /JSON/);
});

test("candidates are validated, de-duplicated and capped", () => {
  const items = d.normalizeItems({
    items: [
      { kind: "lesson", title: "  键由调用方生成  ", payoff: "设计写接口时", projects: ["a", "", "b"], task: " 重复扣款 ", draft: "正文" },
      { kind: "LESSON", title: "键由调用方生成", draft: "重复" },
      { kind: "memory", title: "不是候选的种类", draft: "x" },
      { kind: "trap", title: "", draft: "没有标题" },
      { kind: "strategy", title: "没有正文", draft: "  " },
      null,
      ...Array.from({ length: 12 }, (_, i) => ({ kind: "strategy", title: `打法 ${i}`, draft: "x" })),
    ],
  });
  assert.equal(items.length, 5);
  assert.deepEqual(items[0], { id: d.itemId("lesson", "键由调用方生成"), kind: "lesson", title: "键由调用方生成", payoff: "设计写接口时", projects: ["a", "b"], task: "重复扣款", draft: "正文" });
  assert.equal(items[1].task, "");
  assert.equal(new Set(items.map((i) => i.id)).size, 5);
  assert.deepEqual(d.normalizeItems("nonsense"), []);

  // The names from before the kinds were redrawn are read as the nearest of the four.
  const old = d.normalizeItems({ items: [{ kind: "note", title: "甲", draft: "x" }, { kind: "rule", title: "乙", draft: "x" }, { kind: "skill", title: "丙", draft: "x" }] });
  assert.deepEqual(old.map((i) => i.kind), ["lesson", "craft", "strategy"]);
  // Advice on how to ask is capped, however much of it comes back.
  const advice = d.normalizeItems({ items: [1, 2, 3, 4].map((n) => ({ kind: "craft", title: `用法 ${n}`, draft: "x" })).concat({ kind: "trap", title: "盲点", draft: "x" }) });
  assert.deepEqual(advice.map((i) => i.title), ["用法 1", "用法 2", "盲点"]);
});

test("both CLI output shapes are understood", () => {
  const result = { type: "result", is_error: false, result: '{"items":[]}', total_cost_usd: 0.01, duration_ms: 900, modelUsage: { "m-1": {} } };
  const expected = { text: '{"items":[]}', costUsd: 0.01, durationMs: 900, model: "m-1", usage: require("../src/core/usage").normalize("claude-cli", null, 0.01) };
  assert.deepEqual(d.parseCliOutput(JSON.stringify(result)), expected);
  assert.deepEqual(d.parseCliOutput(JSON.stringify([{ type: "system" }, { type: "assistant" }, result])), expected);
  assert.throws(() => d.parseCliOutput(JSON.stringify({ type: "result", is_error: true, result: "Not logged in" })), /Not logged in/);
  assert.throws(() => d.parseCliOutput("not json"), /无法解析/);
});

test("the prompt tells the model what is already settled and what was skipped", () => {
  const prompt = d.buildPrompt({
    dayKey: "2026-06-10",
    digest: "## 项目：a/b\n材料正文",
    settled: [{ name: "网络", gists: ["滑动窗口"], excerpt: "滑动窗口决定平滑度" }],
    kept: ["先写回滚语句"],
    pending: ["还在等他决定的"],
    skipped: ["一次性的修复"],
  });
  assert.ok(prompt.startsWith("[dotjar-distill]"));
  assert.ok(prompt.includes("- 《网络》：滑动窗口决定平滑度"));
  assert.ok(prompt.includes("他已经留下的") && prompt.includes("- 先写回滚语句"));
  assert.ok(prompt.includes("已经在候选里等他决定的，不要再提：\n- 还在等他决定的"));
  assert.ok(prompt.includes("- 一次性的修复"));
  assert.ok(prompt.includes("今天的材料（2026-06-10）"));
  assert.ok(prompt.trim().endsWith("材料正文"));
});

test("an OpenAI-compatible endpoint can stand in for the local CLI", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ model: "doubao-x", choices: [{ message: { content: '{"items":[]}' } }] }) };
  };
  const res = await d.runOpenAI({ baseUrl: "https://ark.example/api/v3", model: "ep-1", apiKey: "k", prompt: "p", fetchImpl });
  assert.equal(res.text, '{"items":[]}');
  assert.equal(res.model, "doubao-x");
  assert.equal(calls[0].url, "https://ark.example/api/v3/chat/completions");
  assert.equal(calls[0].init.headers.authorization, "Bearer k");
  assert.equal(JSON.parse(calls[0].init.body).messages[1].content, "p");

  const denied = async () => ({ ok: false, status: 401, text: async () => "invalid key" });
  await assert.rejects(d.runOpenAI({ baseUrl: "https://x", model: "m", apiKey: "", prompt: "p", fetchImpl: denied }), /401.*invalid key/);
});

test("the configured engine decides which runner is used", async () => {
  const run = async (args) => ({ text: '{"items":[{"kind":"rule","title":"t","draft":"d"}]}', costUsd: null, durationMs: 1, model: args.model });
  const base = { cwd: "/tmp", dayKey: "2026-06-10", digest: "x", settled: [], kept: [], skipped: [], run };

  const viaApi = await d.distill({ ...base, config: { engine: "openai", api: { baseUrl: "https://x/v1/", model: "m1", apiKey: "k" } } });
  assert.equal(viaApi.items.length, 1);
  assert.equal(viaApi.model, "m1");

  await assert.rejects(d.distill({ ...base, config: { engine: "openai", api: { baseUrl: "", model: "" } } }), (err) => err.code === "NO_API");

  assert.deepEqual(d.apiSettings({ api: { baseUrl: "https://x/v1///", model: "m", apiKey: "inline" } }), { baseUrl: "https://x/v1", model: "m", apiKey: "inline", stream: true });
  process.env.DOTJAR_TEST_KEY = "from-env";
  assert.equal(d.apiSettings({ api: { apiKeyEnv: "DOTJAR_TEST_KEY", apiKey: "inline" } }).apiKey, "from-env");
  delete process.env.DOTJAR_TEST_KEY;
});

test("the day's tasks come back graded, largest first, with nothing invented", () => {
  const tasks = d.normalizeTasks({
    tasks: [
      { title: "发布说明", effort: 1, human: "定哪些改动值得写", ai: "生成初稿", share: "low" },
      { title: "  重复扣款  排查 ", effort: "5", human: "判断幂等键该由谁生成", ai: "复现重试、写压测", share: "HIGH" },
      { title: "", effort: 3 },
      { title: "没有分级的事", effort: 99, share: "很多" },
      "nonsense",
    ],
  });
  assert.deepEqual(tasks.map((t) => [t.title, t.effort, t.share]), [
    ["重复扣款 排查", 5, "high"],
    ["没有分级的事", 5, "mid"],
    ["发布说明", 1, "low"],
  ]);
  assert.equal(tasks[0].human, "判断幂等键该由谁生成");
  assert.deepEqual(d.normalizeTasks({ items: [] }), []);
  assert.equal(d.normalizeTasks({ tasks: Array.from({ length: 9 }, (_, i) => ({ title: `事 ${i}`, effort: 2 })) }).length, 5);
  assert.ok(d.buildPrompt({ dayKey: "x", digest: "y" }).includes('"tasks":[{"title"'));
  // Hours are kept only when they read as a time of day.
  assert.deepEqual(d.normalizeTasks({ tasks: [{ title: "有时间的事", effort: 2, from: "9:05", to: "17:60" }] }).map((t) => [t.from, t.to]), [["09:05", ""]]);
});

test("the prompt asks for plain writing, and for English when the interface is English", () => {
  const zh = d.buildPrompt({ dayKey: "x", digest: "y" });
  const en = d.buildPrompt({ dayKey: "x", digest: "y", language: "en" });
  assert.ok(zh.includes("像他自己随手记笔记那样写"));
  assert.ok(zh.includes("所有字段都用他在材料里主要使用的语言写。"));
  assert.ok(en.includes("所有字段都用英文写") && en.includes("What happened / Next time, say / Why it works / Make it stick"));
  assert.ok(en.includes("What was missed / Why it's easy to miss / Ask this next time"));
});

test("the prompt asks for four kinds of thing, each tied to a moment of the day", () => {
  const zh = d.buildPrompt({ dayKey: "x", digest: "y" });
  // How to work with the agent, then what the work itself taught.
  for (const kind of ["craft（用法）", "strategy（策略）", "lesson（经验）", "trap（盲点）"]) assert.ok(zh.includes(kind), kind);
  assert.deepEqual(d.CANDIDATE_KINDS, ["craft", "strategy", "lesson", "trap"]);
  // Advice has to point at what happened; advice that fits any day is left out.
  assert.ok(zh.includes("每一条都要指得出今天的哪一幕"));
  assert.ok(zh.includes("放到哪天都成立的话也不算"));
  // What to say next time comes ready to copy; a blind spot comes as a question to ask.
  assert.ok(zh.includes("**下次这样说**") && zh.includes("**一劳永逸**") && zh.includes("**下次问这一句**"));
  // Something nobody raised may be offered, marked as not yet checked.
  assert.ok(zh.includes("今天的讨论里没人提") && zh.includes("还没验证"));
  assert.ok(zh.includes("命令参数、API 细节、语法"));
  assert.ok(zh.includes('"doubt":"…"'));
  const [task] = d.normalizeTasks({ tasks: [{ title: "缓存排查", effort: 3, human: "a", ai: "b", doubt: "  命中率  没压测 ", share: "mid" }] });
  assert.equal(task.doubt, "命中率 没压测");
});

test("the day also says how the person is getting on, without making anything up", () => {
  const zh = d.buildPrompt({ dayKey: "x", digest: "y" });
  assert.ok(zh.includes("写事，不写评价") && zh.includes("不要硬夸"));
  assert.ok(zh.includes('"growth":{"highlight":"…","next":"…","applied":[{"title":"…","how":"…"}]}'));

  const growth = d.normalizeGrowth(
    {
      growth: {
        highlight: "  agent 说修好了，你追问了  怎么验证的 ",
        next: "动手前先让 agent 复述范围",
        applied: [
          { title: "先写 回滚语句。", how: " 拦下了删列 " },
          { title: "先写回滚语句", how: "重复的一条" },
          { title: "清单里没有的", how: "编出来的" },
          "nonsense",
        ],
      },
    },
    ["先写回滚语句", "另一条"]
  );
  assert.equal(growth.highlight, "agent 说修好了，你追问了 怎么验证的");
  assert.equal(growth.next, "动手前先让 agent 复述范围");
  // Only something he really kept counts as put to use, under its own title, once.
  assert.deepEqual(growth.applied, [{ title: "先写回滚语句", how: "拦下了删列" }]);
  assert.deepEqual(d.normalizeGrowth({}), { highlight: "", next: "", applied: [] });
  assert.deepEqual(d.normalizeGrowth({ growth: "很棒" }), { highlight: "", next: "", applied: [] });
});

test("left to itself, the engine is whichever this machine has", () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-engines-"));
  const fake = path.join(dir, "codex");
  fs.writeFileSync(fake, "#!/bin/sh\n", { mode: 0o755 });
  const nowhere = path.join(dir, "missing");
  const pathWas = process.env.PATH;
  const homeWas = process.env.HOME;
  // Nothing on PATH, and a home with none of the usual install folders.
  process.env.PATH = dir + path.sep + "empty";
  try {
    const none = { engine: "auto", claudePath: nowhere, codexPath: nowhere, api: {} };
    const available = (cfg) => d.engines(cfg).filter((e) => e.available).map((e) => e.id);
    // Whatever this machine really has installed is found by its usual places; only what is configured can be controlled here.
    if (!available(none).length) {
      assert.equal(d.resolveEngine(none), "claude-cli", "with nothing to use, it stays on the one whose error says what to install");
      assert.equal(d.resolveEngine({ ...none, codexPath: fake }), "codex-cli");
      assert.equal(d.resolveEngine({ ...none, api: { baseUrl: "https://x/v1", model: "m" } }), "openai");
    }
    // A choice that was made is kept, available or not.
    assert.equal(d.resolveEngine({ ...none, engine: "openai" }), "openai");
    assert.equal(d.resolveEngine({ ...none, engine: "codex-cli" }), "codex-cli");
  } finally {
    process.env.PATH = pathWas;
    process.env.HOME = homeWas;
  }
});

test("Codex can go through the day in place of Claude", async () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-fake-codex-"));
  const fake = path.join(dir, "codex");
  const seen = path.join(dir, "seen.txt");
  // Stands in for the real CLI: reads the prompt, writes the last message where -o says.
  fs.writeFileSync(
    fake,
    `#!/bin/sh
if [ "$2" = "--help" ]; then echo "      --ephemeral"; exit 0; fi
out=""; prev=""
for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done
echo "$@" > "${seen}"
cat >> "${seen}"
printf '%s' '{"items":[{"kind":"rule","title":"先写回滚","draft":"正文"}],"tasks":[]}' > "$out"
`,
    { mode: 0o755 }
  );

  const res = await d.runCodex({ codexPath: fake, model: "gpt-x", effort: "low", prompt: "材料在这里", cwd: dir });
  assert.equal(JSON.parse(res.text).items[0].title, "先写回滚");
  assert.equal(res.model, "gpt-x");
  const [args, prompt] = fs.readFileSync(seen, "utf8").split("\n");
  assert.match(args, /^exec --skip-git-repo-check --ephemeral --sandbox read-only -c model_reasoning_effort=low -c tools\.web_search=false -m gpt-x -o \S+ -$/);
  assert.equal(prompt, "材料在这里");

  // The setting decides who is asked.
  const out = await d.distill({ config: { engine: "codex-cli", codexPath: fake }, cwd: dir, dayKey: "x", digest: "y", settled: [], kept: [], skipped: [] });
  assert.deepEqual(out.items.map((i) => i.title), ["先写回滚"]);
  assert.deepEqual(d.engines({ api: {} }).map((e) => e.id), ["claude-cli", "codex-cli", "openai"]);

  // A CLI that writes nothing is an error with its last complaint, not an empty result.
  const mute = path.join(dir, "mute");
  fs.writeFileSync(mute, `#!/bin/sh\nif [ "$2" = "--help" ]; then exit 0; fi\ncat > /dev/null\necho "not logged in" >&2\nexit 1\n`, { mode: 0o755 });
  await assert.rejects(d.runCodex({ codexPath: mute, prompt: "p", cwd: dir }), /退出码 1.*not logged in/);
});
