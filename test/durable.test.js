"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { createClassifier, gistOf, cleanGist, isLinkLine, projectLabel, addedFromUnifiedDiff } = require("../src/core/durable");
const { settledFrom, buildDigest } = require("../src/core/day");

const HOME = "/home/u";
const classifier = createClassifier({
  home: HOME,
  noteDirs: ["/home/u/plain-notes"],
  exists: (p) => p === "/home/u/vault/.obsidian",
});

test("only durable locations count, each as its own kind", () => {
  const kind = (p) => (classifier.classify(p) || {}).kind || null;
  assert.equal(kind("/home/u/vault/Area/网络/推拉流.md"), "note");
  assert.equal(kind("/home/u/plain-notes/a/b.md"), "note");
  assert.equal(kind("/home/u/vault/.obsidian/workspace.md"), null);
  assert.equal(kind("/home/u/repo/CLAUDE.md"), "rule");
  assert.equal(kind("/home/u/repo/sub/AGENTS.md"), "rule");
  assert.equal(kind("/home/u/repo/.cursor/rules/style.mdc"), "rule");
  assert.equal(kind("/home/u/.claude/skills/release-notes/SKILL.md"), "skill");
  assert.equal(kind("/home/u/repo/.claude/commands/ship.md"), "skill");
  assert.equal(kind("/home/u/.claude/projects/-home-u-repo/memory/prefers-short.md"), "memory");
  assert.equal(kind("/home/u/.claude/projects/-home-u-repo/memory/MEMORY.md"), null);
  assert.equal(kind("/home/u/repo/README.md"), null);
  assert.equal(kind("/home/u/repo/src/main.js"), null);
  assert.equal(kind("/home/u/repo/node_modules/x/CLAUDE.md"), null);
  assert.equal(kind("relative/CLAUDE.md"), null);
});

test("where a deposit lives is described from the reader's side", () => {
  assert.equal(classifier.classify("/home/u/vault/Area/网络/推拉流.md").where, path.join("Area", "网络"));
  assert.equal(classifier.classify("/home/u/vault/根笔记.md").where, "vault");
  assert.equal(classifier.classify("/home/u/.claude/CLAUDE.md").where, "全局");
  assert.equal(classifier.classify("/home/u/work/repo/CLAUDE.md").where, "work/repo");
  assert.equal(classifier.classify("/home/u/.claude/skills/release-notes/SKILL.md").where, "release-notes");
});

test("a gist is the heading that was added, without numbering or date stamps", () => {
  assert.equal(gistOf("前文\n## 7. 全链路验收必须保留真实来源（2026-10-13）\n正文"), "全链路验收必须保留真实来源");
  assert.equal(gistOf("---\nname: x\ndescription: 提交说明写原因\n---\n正文在这"), "提交说明写原因");
  assert.equal(gistOf("**核心结论**：键由调用方生成"), "键由调用方生成");
  assert.equal(gistOf(""), "");
  assert.ok(gistOf("很".repeat(200)).length <= 64);
  assert.equal(addedFromUnifiedDiff("--- a\n+++ b\n@@ -1 +1,2 @@\n 旧\n+新一\n-删\n+新二"), "新一\n新二");
});

test("a gist keeps the quotes inside it and passes over lines that only link", () => {
  assert.equal(cleanGist('Web 前端：循环动画与"减少动态效果"'), 'Web 前端：循环动画与"减少动态效果"');
  assert.equal(cleanGist("“整段被引号包着”"), "整段被引号包着");
  assert.equal(cleanGist("- 先写回滚语句"), "先写回滚语句");
  assert.ok(isLinkLine("- [[Area/Programming/Web前端-元素id|Web前端-元素id]]"));
  assert.ok(isLinkLine("[文档](https://x.example/a), [[b]]"));
  assert.ok(!isLinkLine("见 [[b]] 的第二节"));
  assert.ok(!isLinkLine("普通一句话"));
  assert.equal(gistOf("- [[Area/索引页|索引页]]\n- [[Area/另一页]]"), "");
});

test("an edit that only added links settled nothing, new file or not", () => {
  const touched = [
    { path: "/home/u/vault/Area/00-导航.md", added: "- [[Area/新笔记|新笔记]]", ts: 10, project: "p" },
    { path: "/home/u/vault/Area/新笔记.md", added: "# 新笔记\n正文", ts: 11, project: "p" },
  ];
  // Both look new: an index rewritten whole gets a fresh birth time too.
  const settled = settledFrom(touched, classifier, { stat: () => ({ birthtimeMs: 100 }), since: 50 });
  assert.deepEqual(settled.map((s) => s.name), ["新笔记"]);
});

test("project labels fold agent worktrees back into their repo", () => {
  assert.equal(projectLabel("/home/u/repos/home/app/.claude/worktrees/x-123", HOME), "home/app");
  assert.equal(projectLabel("/home/u/repos/app", HOME), "repos/app");
  assert.equal(projectLabel(HOME, HOME), "~");
  assert.equal(projectLabel("", HOME), "未知项目");
});

test("several edits to one note settle as one entry", () => {
  const touched = [
    { path: "/home/u/vault/Area/网络.md", added: "## 滑动窗口决定平滑度\n正文", ts: 10, project: "relay" },
    { path: "/home/u/vault/Area/网络.md", added: "## 丢帧只是接收端计数\n正文", ts: 30, project: "web" },
    { path: "/home/u/repo/CLAUDE.md", added: "先写回滚语句", ts: 20, project: "repo" },
    { path: "/home/u/repo/src/a.js", added: "code", ts: 40, project: "repo" },
    { path: "/home/u/vault/Area/已删除.md", added: "x", ts: 50, project: "repo" },
  ];
  const stat = (p) => (p.includes("已删除") ? null : { birthtimeMs: p.endsWith("CLAUDE.md") ? 5 : 100 });
  const settled = settledFrom(touched, classifier, { stat, since: 50 });
  assert.deepEqual(settled.map((s) => [s.kind, s.name, s.isNew]), [["note", "网络", true], ["rule", "CLAUDE.md", false]]);
  assert.deepEqual(settled[0].gists, ["滑动窗口决定平滑度", "丢帧只是接收端计数"]);
  assert.deepEqual(settled[0].projects, ["relay", "web"]);
  assert.ok(settled[0].excerpt.includes("滑动窗口决定平滑度"));
});

test("the digest stays within budget and keeps how a long session began and ended", () => {
  const turns = Array.from({ length: 40 }, (_, i) => ({ ts: i, user: `问题 ${i} ` + "细节".repeat(120), reply: `# 结论 ${i}\n` + "说明".repeat(300) }));
  const sessions = [
    { agent: "claude-code", project: "a/b", title: "长会话", firstTs: 0, lastTs: 1, turns },
    { agent: "inbox", project: "收件箱", title: "", firstTs: 2, lastTs: 3, turns: [{ ts: 2, user: "", reply: "", note: "手动存入的一段", from: "豆包" }] },
  ];
  const d = buildDigest(sessions, { budget: 12000 });
  assert.ok(d.text.length <= 12100);
  assert.equal(d.stats.sessions, 2);
  assert.equal(d.stats.turns, 41);
  assert.equal(d.stats.projects, 2);
  assert.ok(d.text.includes("问题 0 "), "first ask kept");
  assert.ok(d.text.includes("问题 39 "), "last ask kept");
  assert.ok(d.text.includes("中间略"));
  assert.ok(d.text.includes("【结论 39】"), "reply headings are demoted so they cannot pass for digest structure");
  assert.ok(d.text.includes("他存下的一段（来自 豆包）：手动存入的一段"));
});
