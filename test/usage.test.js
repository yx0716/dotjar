"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
process.env.DOTJAR_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-usage-"));
const { normalize } = require("../src/core/usage");
const runs = require("../src/core/runs");
const d = require("../src/core/distill");
const display = require("../src/overlay/usage");
const day = "2026-11-11";

test("provider cache/reasoning counts are not double-counted; absent is not zero", () => {
  const claude = normalize("claude-cli", { input_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 20, output_tokens: 5, secret: "no" }, .02);
  assert.equal(claude.input, 110); assert.equal(claude.total, 115);
  const codex = normalize("codex-cli", { input_tokens: 110, cached_input_tokens: 80, output_tokens: 5, reasoning_output_tokens: 3 });
  const api = normalize("openai", { prompt_tokens: 110, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 80 }, completion_tokens_details: { reasoning_tokens: 3 } });
  assert.equal(codex.total, 115); assert.equal(api.total, 115);
  assert.equal(normalize("claude-cli", { input_tokens: 10, output_tokens: 5 }).total, null);
  assert.equal(normalize("openai", { total_tokens: 99 }).total, null);
  assert.equal(normalize("openai", { prompt_tokens: -1, completion_tokens: 5 }).total, null);
  assert.equal(normalize("codex-cli", { input_tokens: "10", output_tokens: 5 }).total, null);
  assert.equal(normalize("openai", { prompt_tokens: 0, completion_tokens: 0 }).total, 0);
  assert.equal(claude.secret, undefined);
  assert.match(display.consumption({ usage: claude }), /参考费用约 \$0.0200/);
  assert.match(display.consumption({ usage: codex }), /115 tokens/);
  assert.equal(display.consumption({ usage: null }), "消耗暂不可获取");
  assert.match(display.consumption({ usage: normalize("openai", { prompt_tokens: 0, completion_tokens: 0 }) }), /^0 tokens$/);
});

test("each attempt survives retries, invalid answers and cancellation without storing content", async () => {
  const opts = { config: { engine: "openai", api: { baseUrl: "https://example.invalid", model: "test", apiKey: "secret-key" } }, dayKey: day, digest: "private transcript", kept: [] };
  const usage = normalize("openai", { prompt_tokens: 100, completion_tokens: 20 });
  const success = await d.distill({ ...opts, run: async () => ({ text: '{"items":[]}', usage }) });
  await assert.rejects(d.distill({ ...opts, run: async () => ({ text: "private invalid answer", usage }) }), /JSON/);
  const abort = new AbortController(); abort.abort();
  let called = false;
  await assert.rejects(d.distill({ ...opts, signal: abort.signal, run: async () => { called = true; } }), /取消/);
  assert.equal(called, false);
  const records = runs.list(day).records;
  assert.equal(records.length, 3);
  assert.equal(new Set(records.map((r) => r.id)).size, 3);
  assert.equal(records.find((r) => r.status === "failed").usage.total, 120);
  assert.equal(records.find((r) => r.status === "cancelled").usage, null);
  assert.equal(records.find((r) => r.id === success.runRecord.id).status, "succeeded");
  for (const name of fs.readdirSync(path.join(process.env.DOTJAR_HOME, "runs"))) {
    const file = path.join(process.env.DOTJAR_HOME, "runs", name);
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /secret-key|private transcript|private invalid answer/);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  const interrupted = runs.start("2026-11-10", "codex-cli");
  runs.update(interrupted, { pid: -1 });
  assert.equal(runs.list("2026-11-10").records[0].status, "interrupted");
  assert.equal(runs.list("2026-11-09").records.length, 0);
  assert.throws(() => runs.list("../../config"), /日期/);
});

test("provider error envelopes retain reported consumption", async () => {
  const raw = { type: "result", is_error: true, result: "limit", total_cost_usd: .01, usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
  assert.throws(() => d.parseCliOutput(JSON.stringify(raw)), (err) => err.usage.total === 3 && err.usage.estimatedUsd === .01);
  const fetchImpl = async () => ({ ok: true, text: async () => JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [] }) });
  await assert.rejects(d.runOpenAI({ baseUrl: "https://example.invalid", fetchImpl }), (err) => err.usage.total === 15);
  const denied = async () => ({ ok: false, status: 429, text: async () => JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 5 } }) });
  await assert.rejects(d.runOpenAI({ baseUrl: "https://example.invalid", fetchImpl: denied }), (err) => err.usage.total === 15);
});

test("Codex captures chunked JSON events once, retains usage on failed exits, and bounds log memory", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-codex-usage-"));
  const fake = path.join(dir, "codex");
  fs.writeFileSync(fake, `#!${process.execPath}
const fs = require('fs');
if (process.argv.includes('--help')) { console.log('--json --ephemeral'); process.exit(0); }
if (!process.argv.includes('--json')) process.exit(2);
const args = process.argv.slice(2); const out = args[args.indexOf('-o')+1];
process.stdin.resume();
process.stdin.on('end', () => {
fs.writeFileSync(out, '{"items":[]}');
process.stdout.write('x'.repeat(70000)+'\\n');
process.stdout.write('{"type":"turn.com');
setTimeout(() => {
const tail = 'pleted","usage":{"input_tokens":100,"cached_input_tokens":80,"output_tokens":10}}';
process.stdout.write(tail+'\\n');
process.stdout.write('{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":80,"output_tokens":10}}');
}, 5);
});
`, { mode: 0o755 });
  const res = await d.runCodex({ codexPath: fake, cwd: dir, prompt: "test" });
  assert.equal(res.usage.total, 110);
  assert.equal(JSON.parse(res.text).items.length, 0);
  fs.writeFileSync(fake, fs.readFileSync(fake, "utf8").replace("}, 5);", "process.exitCode = 1; }, 5);"));
  await assert.rejects(d.runCodex({ codexPath: fake, cwd: dir, prompt: "test" }), (err) => err.usage.total === 110);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the shared capture pipeline records actual additions and preserves failed consumption", async () => {
  const config = require("../src/core/config");
  const dotjar = require("../src/core/dotjar");
  const home = process.env.DOTJAR_HOME;
  const cfg = config.save({ engine: "openai", api: { baseUrl: "https://example.invalid", model: "test" }, claudeDir: path.join(home, "empty-claude"), codexDir: path.join(home, "empty-codex"), agentHome: home, noteDirs: [] });
  dotjar.capture("usage pipeline fixture", { from: "test" }, cfg);
  const usage = normalize("openai", { prompt_tokens: 10, completion_tokens: 5 });
  const run = async () => ({ text: '{"items":[{"kind":"lesson","title":"A reusable finding","draft":"Example"}]}', usage });
  const first = await dotjar.distillToday(cfg, { run });
  const second = await dotjar.distillToday(cfg, { run });
  assert.equal(first.found, 1); assert.equal(second.found, 0);
  assert.equal(second.view.latestRun.found, 0);
  const ledger = require("../src/core/ledger");
  const save = ledger.saveDay;
  // Fail only after the model ran, so accounting must survive a star-write error.
  const failOnSave = async () => { ledger.saveDay = () => { throw new Error("simulated disk error"); }; return { text: '{"items":[]}', usage }; };
  try { await assert.rejects(dotjar.distillToday(cfg, { run: failOnSave }), /simulated disk error/); }
  finally { ledger.saveDay = save; }
  const records = runs.list(second.view.day).records;
  assert.ok(records.some((r) => r.status === "failed" && r.usage?.total === 15));
});
