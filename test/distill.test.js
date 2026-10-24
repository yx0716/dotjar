"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

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
      { kind: "note", title: "  键由调用方生成  ", payoff: "设计写接口时", projects: ["a", "", "b"], task: " 重复扣款 ", draft: "正文" },
      { kind: "NOTE", title: "键由调用方生成", draft: "重复" },
      { kind: "memory", title: "不是候选的种类", draft: "x" },
      { kind: "rule", title: "", draft: "没有标题" },
      { kind: "skill", title: "没有正文", draft: "  " },
      null,
      ...Array.from({ length: 12 }, (_, i) => ({ kind: "rule", title: `规则 ${i}`, draft: "x" })),
    ],
  });
  assert.equal(items.length, 5);
  assert.deepEqual(items[0], { id: d.itemId("note", "键由调用方生成"), kind: "note", title: "键由调用方生成", payoff: "设计写接口时", projects: ["a", "b"], task: "重复扣款", draft: "正文" });
  assert.equal(items[1].task, "");
  assert.equal(new Set(items.map((i) => i.id)).size, 5);
  assert.deepEqual(d.normalizeItems("nonsense"), []);
});

test("both CLI output shapes are understood", () => {
  const result = { type: "result", is_error: false, result: '{"items":[]}', total_cost_usd: 0.01, duration_ms: 900, modelUsage: { "m-1": {} } };
  const expected = { text: '{"items":[]}', costUsd: 0.01, durationMs: 900, model: "m-1" };
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
    skipped: ["一次性的修复"],
  });
  assert.ok(prompt.startsWith("[dotjar-distill]"));
  assert.ok(prompt.includes("已写入《网络》：滑动窗口决定平滑度"));
  assert.ok(prompt.includes("- 先写回滚语句"));
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

  assert.deepEqual(d.apiSettings({ api: { baseUrl: "https://x/v1///", model: "m", apiKey: "inline" } }), { baseUrl: "https://x/v1", model: "m", apiKey: "inline" });
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
  assert.ok(en.includes("所有字段都用英文写") && en.includes("Something odd / What's going on / Today, again"));
  assert.ok(zh.includes("note（心得）"));
});

test("the prompt asks for ways of thinking, not facts, and for what to doubt", () => {
  const zh = d.buildPrompt({ dayKey: "x", digest: "y" });
  assert.ok(zh.includes("他要留下的是思考方式"));
  assert.ok(zh.includes("遇到现象时该往哪想、能看出一个答案对不对"));
  assert.ok(zh.includes("**先看一件怪事**") && zh.includes("**想再往下挖**") && !zh.includes("易错"));
  assert.ok(zh.includes("命令参数、API 细节、语法"));
  assert.ok(zh.includes('"doubt":"…"'));
  const [task] = d.normalizeTasks({ tasks: [{ title: "缓存排查", effort: 3, human: "a", ai: "b", doubt: "  命中率  没压测 ", share: "mid" }] });
  assert.equal(task.doubt, "命中率 没压测");
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
