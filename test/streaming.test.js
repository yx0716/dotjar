"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
process.env.DOTJAR_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-stream-"));
const { partialItems } = require("../src/core/partial-items");
const d = require("../src/core/distill");
const { runCodexStream } = require("../src/core/codex-stream");
const { readChatStream } = require("../src/core/chat-stream");
const item = { kind: "lesson", title: "先核验", draft: '含有 } ] { 和 "引号"，以及 \\ 路径' };
const answer = JSON.stringify({ items: [item, { ...item, title: "第二颗" }], tasks: [] });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("only complete item objects are previewed at every possible stream split", () => {
  const first = JSON.stringify(item);
  const boundary = answer.indexOf(first) + first.length;
  for (let i = 0; i < boundary; i++) assert.equal(partialItems(answer.slice(0, i)).length, 0, `split ${i}`);
  assert.deepEqual(partialItems(answer.slice(0, boundary)), [item]);
  assert.deepEqual(partialItems(answer), [item, { ...item, title: "第二颗" }]);
  assert.deepEqual(partialItems('```json\n{"tasks":[],"items":[' + first + ','), [item]);
  assert.deepEqual(partialItems('{"note":"fake \\"items\\": []","items":['), []);
  assert.deepEqual(partialItems('{"items":[{"kind":"lesson","title":"half"'), []);
});

test("HTTP streaming exposes a complete card before the response ends and retains final usage", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const boundary = answer.indexOf(JSON.stringify(item)) + JSON.stringify(item).length;
  const frame = (text) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\r\n\r\n`;
  let preview;
  const body = (async function* () {
    const bytes = Buffer.from(frame(answer.slice(0, boundary)));
    for (let i = 0; i < bytes.length; i++) yield bytes.subarray(i, i + 1);
    await gate;
    yield Buffer.from(frame(answer.slice(boundary)));
    yield Buffer.from('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":20}}\n\ndata: [DONE]\n\n');
  })();
  const promise = readChatStream({ body }, { model: "m", onText: (text) => { preview = partialItems(text); } });
  await sleep(20);
  assert.deepEqual(preview, [item]);
  release();
  const result = await promise;
  assert.equal(result.text, answer); assert.equal(result.usage.total, 120);
  await assert.rejects(readChatStream({ body: (async function* () { yield Buffer.from(frame("half")); })() }, { model: "m" }), /断开/);
});

function fakeCodex(mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-stream-cli-"));
  const file = path.join(dir, "codex");
  fs.writeFileSync(file, `#!${process.execPath}
const fs=require('fs'), readline=require('readline');
const send=(x)=>process.stdout.write(JSON.stringify(x)+'\\n');
const mode=${JSON.stringify(mode)}, answer=${JSON.stringify(answer)};
readline.createInterface({input:process.stdin}).on('line', line=>{
const m=JSON.parse(line);
if(m.method==='initialize') { send({id:m.id,result:{}}); }
if(m.method==='thread/start') {
if(m.params.ephemeral!==true || m.params.sandbox!=='read-only' || m.params.approvalPolicy!=='never') process.exit(9);
if(mode==='unsupported') { send({id:m.id,error:{message:'unsupported'}}); return; }
send({id:m.id,result:{thread:{id:'t',ephemeral:true},model:'actual-model'}});
}
if(m.method==='turn/start') {
fs.writeFileSync(${JSON.stringify(path.join(dir, "started"))},'1');
if(mode==='disconnect') { process.exit(1); }
send({id:m.id,result:{turn:{id:'r'}}});
send({method:'item/agentMessage/delta',params:{threadId:'t',turnId:'r',itemId:'a',delta:answer.slice(0,answer.indexOf('},{')+1)}});
send({method:'thread/tokenUsage/updated',params:{threadId:'t',turnId:'r',tokenUsage:{total:{inputTokens:100,outputTokens:20,cachedInputTokens:40,reasoningOutputTokens:5}}}});
setTimeout(()=>{
send({method:'item/completed',params:{threadId:'t',turnId:'r',item:{type:'agentMessage',id:'a',text:answer}}});
send({method:'turn/completed',params:{threadId:'t',turn:{id:'r',status:'completed'}}});
},150);
}
});
`, { mode: 0o755 });
  return { dir, file };
}

test("Codex app-server exposes deltas before completion and never enables retry after turn/start", async () => {
  const cli = fakeCodex("ok");
  let preview, done = false;
  const job = runCodexStream({ codexPath: cli.file, cwd: cli.dir, prompt: "test", onText: (text) => { preview = partialItems(text); }, timeoutMs: 2000 }).then((r) => { done = true; return r; });
  for (let i = 0; i < 80 && !preview; i++) await sleep(10);
  assert.equal(done, false); assert.equal(preview.length, 1);
  const result = await job;
  assert.equal(result.model, "actual-model"); assert.equal(result.text, answer); assert.equal(result.usage.total, 120);
  const old = fakeCodex("unsupported");
  await assert.rejects(runCodexStream({ codexPath: old.file, cwd: old.dir, prompt: "test", timeoutMs: 2000 }), (e) => e.code === "NO_STREAM");
  assert.equal(fs.existsSync(path.join(old.dir, "started")), false);
  const broken = fakeCodex("disconnect");
  await assert.rejects(runCodexStream({ codexPath: broken.file, cwd: broken.dir, prompt: "test", timeoutMs: 2000 }), (e) => e.code !== "NO_STREAM");
  for (const c of [cli, old, broken]) fs.rmSync(c.dir, { recursive: true, force: true });
});

test("Claude stream-json uses text deltas and the result envelope for accounting", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-claude-stream-"));
  const file = path.join(dir, "claude");
  fs.writeFileSync(file, `#!${process.execPath}
if(process.argv.includes('--help')) {console.log('--include-partial-messages');process.exit(0);}
if(!process.argv.includes('stream-json')) process.exit(9);
const send=(x)=>process.stdout.write(JSON.stringify(x)+'\\n');
process.stdin.resume();process.stdin.on('end',()=>{
send({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:${JSON.stringify(answer)}}}});
setTimeout(()=>send({type:'result',result:${JSON.stringify(answer)},total_cost_usd:.02,usage:{input_tokens:10,output_tokens:5,cache_read_input_tokens:0,cache_creation_input_tokens:0}}),100);
});`, { mode: 0o755 });
  let preview;
  const res = await d.runClaude({ claudePath: file, cwd: dir, prompt: "test", onText: (text) => { preview = partialItems(text); } });
  assert.equal(preview.length, 2); assert.equal(res.usage.total, 15); assert.equal(res.costUsd, .02);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("background session returns a job immediately, shares duplicate starts and retains preview on failure", async () => {
  const cfg = require("../src/core/config");
  const home = process.env.DOTJAR_HOME;
  cfg.save({ claudeDir: path.join(home, "empty-claude"), codexDir: path.join(home, "empty-codex"), agentHome: home });
  let release, calls = 0;
  const wait = new Promise((resolve) => { release = resolve; });
  const session = require("../src/core/session").createSession({ distillToday: async (_, options) => {
    calls++; options.onProgress([item]); await wait; throw new Error("fixture disconnected");
  } });
  await session.today("2026-11-11");
  const accepted = session.startDistill();
  assert.equal(session.startDistill().id, accepted.id); assert.equal(calls, 1);
  const running = session.jobStatus(accepted.id);
  assert.equal(running.status, "running"); assert.equal(running.preview[0].title, item.title);
  assert.ok(require("../src/core/operations").active().length > 0, "background write gate stays registered");
  release();
  for(let i=0;i<20 && session.isDistilling();i++) await sleep(5);
  assert.equal(session.jobStatus(accepted.id).status, "failed");
  assert.equal(session.jobStatus(accepted.id).preview.length, 1);
  assert.equal(session.isDistilling(), false);
  assert.equal(require("../src/core/operations").active().length, 0);
});

test("authenticated HTTP start responds while the background model is still pending", async (t) => {
  let release, completed = false, calls = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const session = require("../src/core/session").createSession({ distillToday: async (_, options) => {
    calls++; options.onProgress([item]); await pending; completed = true;
    return { found: 0 };
  } });
  await session.today("2026-11-11");
  const server = require("../src/server");
  const srv = server.createServer({ session, token: "stream-fixture" });
  const port = await server.listen(srv, 0);
  t.after(() => { release(); srv.close(); });
  const post = (name, args = [], authenticated = true) => fetch(`http://127.0.0.1:${port}/api/${name}`, {
    method: "POST", headers: { "content-type": "application/json", "x-dotjar": "1", ...(authenticated ? { cookie: `${server.COOKIE}=stream-fixture` } : {}) },
    body: JSON.stringify({ args }), signal: AbortSignal.timeout(2000),
  });
  assert.equal((await post("startDistill", [], false)).status, 403); assert.equal(calls, 0);
  const start = await (await post("startDistill")).json();
  assert.ok(start.value.id); assert.equal(completed, false);
  const status = await (await post("jobStatus", [start.value.id])).json();
  assert.equal(status.value.status, "running"); assert.equal(status.value.preview.length, 1);
  assert.equal((await (await post("startDistill")).json()).value.id, start.value.id); assert.equal(calls, 1);
  release();
  for (let i = 0; i < 50 && session.isDistilling(); i++) await sleep(10);
  assert.equal(session.jobStatus(start.value.id).status, "succeeded");
});


test("stream usage survives disconnect as explicitly incomplete accounting", async () => {
  const config = { engine: "openai", api: { baseUrl: "https://example.invalid", model: "test" } };
  const dayKey = "2026-11-08";
  await assert.rejects(d.distill({ config, dayKey, digest: "test", kept: [], onProgress: () => {}, run: async ({ onUsage }) => {
    onUsage(require("../src/core/usage").normalize("openai", { prompt_tokens: 10, completion_tokens: 2 }));
    throw new Error("stream disconnected");
  } }), /disconnected/);
  const record = require("../src/core/runs").list(dayKey).records[0];
  assert.equal(record.usage.total, 12); assert.equal(record.usageComplete, false);
  assert.match(require("../src/overlay/usage").consumption(record), /统计不完整/);
});
