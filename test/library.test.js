"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

function freshHome() {
  process.env.DOTJAR_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-lib-"));
  return process.env.DOTJAR_HOME;
}

const config = require("../src/core/config");
const ledger = require("../src/core/ledger");
const library = require("../src/core/library");
const { itemId } = require("../src/core/distill");

const item = (kind, title, draft) => ({ id: itemId(kind, title), kind, title, payoff: "再设计写接口时", projects: ["a/b"], draft });

test("a deposit reads back as title, kind, day, payoff and rendered body", () => {
  const stat = { mtimeMs: new Date(2026, 5, 12, 9).getTime() };
  const text = ledger.renderDeposit(item("rule", "先写回滚语句", "写迁移前先给出回滚。\n\n**Why**：补得不从容"), "2026-06-10");
  const note = library.parseNote("/d/先写回滚语句.md", text, stat);
  assert.equal(note.title, "先写回滚语句");
  assert.equal(note.kind, "rule");
  assert.equal(note.day, "2026-06-10");
  assert.equal(note.payoff, "再设计写接口时");
  assert.deepEqual(note.projects, ["a/b"]);
  assert.ok(note.html.includes("<strong>Why</strong>"));
  assert.ok(!note.html.includes("什么时候用上"), "the payoff line is lifted out of the body");
  assert.ok(!note.html.includes("先写回滚语句"), "the title heading is lifted out of the body");
});

test("a note someone wrote by hand is still shelved", () => {
  const stat = { mtimeMs: new Date(2026, 5, 12, 9).getTime() };
  const note = library.parseNote("/d/随手记.md", "没有 frontmatter，也没有标题。\n\n- 一条", stat);
  assert.equal(note.title, "随手记");
  assert.equal(note.kind, "note");
  assert.equal(note.day, "2026-06-12");
  assert.ok(note.html.includes("<li>一条</li>"));
  assert.deepEqual(library.parseFrontmatter('---\nkind: skill\ntags: [a, "b c"]\n---\n正文').meta, { kind: "skill", tags: ["a", "b c"] });
});

test("the page gathers kept notes and what agents wrote, newest day first", () => {
  const home = freshHome();
  const cfg = config.load();
  const a = item("note", "键由调用方生成", "**核心结论**：正文 <script>alert(1)</script>");
  const b = item("skill", "排查 CI 失败的四步", "1. 第一步");
  ledger.saveDay(ledger.snapshotSettled(ledger.applyDistilled(ledger.loadDay("2026-06-09"), [b]), [{ kind: "memory", name: "偏好", gists: ["提交说明写原因"], where: "repo", path: "/vault/偏好.md", ts: 1 }]));
  ledger.keep("2026-06-09", b.id, config.depositDir(cfg));
  ledger.saveDay(ledger.applyDistilled(ledger.loadDay("2026-06-10"), [a]));
  const kept = ledger.keep("2026-06-10", a.id, config.depositDir(cfg)).item;
  // A kept note that an agent also touched is listed once, as the note.
  ledger.saveDay(ledger.snapshotSettled(ledger.loadDay("2026-06-10"), [{ kind: "note", name: "键由调用方生成", gists: [], where: "x", path: kept.file, ts: 2 }]));

  const model = library.collect(cfg, "zh");
  assert.deepEqual(model.days.map((d) => [d.day, d.notes.length, d.pointers.length]), [["2026-06-10", 1, 0], ["2026-06-09", 1, 1]]);
  assert.equal(model.notes, 2);
  assert.equal(model.pointers, 1);

  const file = library.build(cfg, new Date(2026, 5, 10, 18, 5), "zh");
  assert.equal(file, path.join(home, "library.html"));
  const html = fs.readFileSync(file, "utf8");
  assert.ok(html.includes("你落库了 2 篇，agent 另外写下 1 处。6月10日 18:05 更新。"));
  assert.ok(html.indexOf("键由调用方生成") < html.indexOf("排查 CI 失败的四步"));
  assert.ok(html.includes("agent 写进《偏好》"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!html.includes("<script>alert(1)"));
  assert.ok(!/https?:\/\//.test(html), "one self-contained file: nothing is loaded from the network");
});

test("with nothing settled the page says how to start", () => {
  freshHome();
  const html = library.renderPage(library.collect(config.load(), "zh"), new Date(2026, 5, 10, 8, 0));
  assert.ok(html.includes("库存还是空的。"));
  assert.ok(html.includes("你落库了 0 篇"));
  const other = library.renderPage({ ...library.collect(config.load(), "zh"), wording: "攒" }, new Date(2026, 5, 10, 8, 0));
  assert.ok(other.includes("<h1>家底</h1>") && other.includes("你攒了 0 篇"), "the wording is one config value");
  const english = library.renderPage(library.collect(config.load(), "en"), new Date(2026, 5, 10, 8, 0));
  assert.ok(english.includes('<html lang="en">') && english.includes("<h1>Library</h1>"));
  assert.ok(english.includes("You kept 0 notes. Agents wrote in 0 other places. Updated Jun 10, 08:00."));
  assert.ok(!/[\u4e00-\u9fff]/.test(english.replace(/<style>[\s\S]*?<\/style>/, "")), "an English page has no Chinese left in it");
});

test("what an agent wrote opens as a card with the sections it added that day", () => {
  const home = freshHome();
  const cfg = config.load();
  const vault = path.join(home, "vault");
  fs.mkdirSync(vault, { recursive: true });
  const net = path.join(vault, "网络.md");
  fs.writeFileSync(net, "# 网络\n\n## 旧的一节\n旧内容\n\n## 7. 端口按连接发起侧申请（2026-06-10）\n**核心结论**：谁发起连接，就按谁申请。\n\n### 例子\n推流是相机发起。\n\n## 后来的一节\n别的\n");
  const quoted = path.join(vault, "动画.md");
  fs.writeFileSync(quoted, '---\ncreated: 2026-06-10\n---\n\n# 循环动画与"减少动态效果"\n\n## 第一条\n内容\n');
  const index = path.join(vault, "00-导航.md");
  fs.writeFileSync(index, "# 导航\n- [[Area/动画|动画]]\n");
  ledger.saveDay(
    ledger.snapshotSettled(ledger.loadDay("2026-06-10"), [
      { kind: "note", name: "网络", gists: ["端口按连接发起侧申请"], where: "vault", path: net, ts: 3, isNew: false },
      { kind: "note", name: "动画", gists: ['循环动画与"减少动态效果'], where: "vault", path: quoted, ts: 2, isNew: true },
      // Recorded before link-only edits were left out.
      { kind: "note", name: "00-导航", gists: ["- Area/动画"], where: "vault", path: index, ts: 1, isNew: true },
      { kind: "memory", name: "偏好", gists: ["提交说明写原因"], where: "repo", path: path.join(vault, "已删.md"), ts: 0 },
    ])
  );

  const model = library.collect(cfg, "zh");
  const cards = model.days[0].pointers;
  assert.deepEqual(cards.map((p) => p.part.title), ["端口按连接发起侧申请", '循环动画与"减少动态效果"', "提交说明写原因"]);
  // Only the section added that day, sub-sections included, its heading as the title.
  assert.ok(cards[0].part.html.includes("谁发起连接") && cards[0].part.html.includes("推流是相机发起"));
  assert.ok(!cards[0].part.html.includes("旧内容") && !cards[0].part.html.includes("别的"));
  // A new file in full, without repeating its heading.
  assert.ok(cards[1].part.html.includes("第一条") && !cards[1].part.html.includes("减少动态效果"));
  assert.equal(cards[2].part.gone, true);

  const html = library.renderPage(model, new Date(2026, 5, 10, 18, 0));
  assert.equal((html.match(/class="item note by-agent"/g) || []).length, 3);
  assert.ok(html.includes("这个文件后来被删掉或挪走了。"));
  assert.ok(!html.includes("00-导航"), "an index page that only gained a link is not listed");
});

test("tables in a note render as tables, and a stray pipe stays text", () => {
  const markdown = require("../src/overlay/markdown");
  const html = markdown.render("| 端口 | 协议 |\n|---|:--:|\n| 22 | `TCP` |\n| <b>x</b> |\n\na | b");
  assert.ok(html.includes("<thead><tr><th>端口</th><th>协议</th></tr></thead>"));
  assert.ok(html.includes("<td>22</td><td><code>TCP</code></td>"));
  assert.ok(html.includes("<td>&lt;b&gt;x&lt;/b&gt;</td><td></td>"), "cells are escaped, short rows padded");
  assert.ok(html.includes("<p>a | b</p>"));
});

test("a kept note can be taken out of the library and put back; an agent's file is only hidden", () => {
  const home = freshHome();
  const cfg = config.load();
  const { createSession } = require("../src/core/session");
  const a = item("note", "键由调用方生成", "**核心结论**：正文");
  ledger.saveDay(ledger.applyDistilled(ledger.loadDay("2026-06-10"), [a]));
  const kept = ledger.keep("2026-06-10", a.id, config.depositDir(cfg)).item;
  const vault = path.join(home, "vault");
  fs.mkdirSync(vault, { recursive: true });
  const agentFile = path.join(vault, "网络.md");
  fs.writeFileSync(agentFile, "# 网络\n\n## 端口按发起侧申请\n正文\n");
  ledger.saveDay(ledger.snapshotSettled(ledger.loadDay("2026-06-10"), [{ kind: "note", name: "网络", gists: ["端口按发起侧申请"], where: "v", path: agentFile, ts: 1, isNew: false }]));

  const session = createSession({ language: "zh" });
  const page = () => fs.readFileSync(session.library(), "utf8");
  assert.ok(page().includes("键由调用方生成") && page().includes("端口按发起侧申请"));
  assert.ok(page().includes('class="rm"'));

  // A kept note: set aside in dotjar's trash, its candidate now passed over.
  const undo = session.removeFromLibrary(kept.file);
  assert.ok(!fs.existsSync(kept.file) && fs.existsSync(undo.setAside));
  assert.equal(path.dirname(undo.setAside), path.join(home, "trash"));
  assert.equal(ledger.loadDay("2026-06-10").items[0].status, "skipped");
  assert.ok(!page().includes("键由调用方生成"));
  session.restoreToLibrary(undo);
  assert.ok(fs.existsSync(kept.file));
  assert.equal(ledger.loadDay("2026-06-10").items[0].status, "kept");
  assert.ok(page().includes("键由调用方生成"));

  // Something an agent wrote: no longer listed, the file left where it is.
  const hide = session.removeFromLibrary(agentFile);
  assert.equal(hide.hidden, true);
  assert.ok(fs.existsSync(agentFile));
  assert.ok(!page().includes("端口按发起侧申请"));
  session.restoreToLibrary(hide);
  assert.ok(page().includes("端口按发起侧申请"));

  // Putting back never reaches outside dotjar's own trash.
  assert.throws(() => session.restoreToLibrary({ file: kept.file + "x", setAside: "/etc/hosts" }));
});
