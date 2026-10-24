"use strict";

// Turns a day's raw sessions into the two things the veil shows and the
// distiller reads: what already settled, and a compact digest of the rest.

const fs = require("fs");
const path = require("path");

const { gistOf, isLinkLine } = require("./durable");
const { AGENT_NAME } = require("./agents");

const MAX_GISTS = 4;
const EXCERPT_LIMIT = 420;

// Durable files agents wrote today, one entry per file.
function settledFrom(touched, classifier, options = {}) {
  const stat = options.stat || safeStat;
  const since = options.since || 0;
  const byPath = new Map();
  for (const t of touched) {
    const hit = classifier.classify(t.path);
    if (!hit) continue;
    let entry = byPath.get(t.path);
    if (!entry) {
      entry = { kind: hit.kind, path: t.path, name: displayName(t.path, hit.kind), where: hit.where, gists: [], excerpt: "", projects: [], ts: 0, isNew: false, prose: false, source: "agent" };
      byPath.set(t.path, entry);
    }
    if (!entry.prose && t.added) entry.prose = String(t.added).split("\n").some((l) => l.trim() && !isLinkLine(l.trim()));
    const gist = gistOf(t.added);
    if (gist && gist !== entry.name && !entry.gists.includes(gist) && entry.gists.length < MAX_GISTS) entry.gists.push(gist);
    if (t.added && entry.excerpt.length < EXCERPT_LIMIT) {
      entry.excerpt = `${entry.excerpt} ${t.added.replace(/\s+/g, " ").trim()}`.trim().slice(0, EXCERPT_LIMIT);
    }
    if (t.project && !entry.projects.includes(t.project)) entry.projects.push(t.project);
    if (t.ts > entry.ts) entry.ts = t.ts;
  }
  const out = [];
  for (const entry of byPath.values()) {
    const st = stat(entry.path);
    if (!st) continue; // written and later removed: nothing settled
    entry.isNew = st.birthtimeMs >= since;
    // Edits that only added links (to an index page, say) settled nothing.
    if (!entry.prose) continue;
    out.push(entry);
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

function safeStat(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function displayName(filePath, kind) {
  const base = path.basename(filePath);
  if (kind === "rule") return base;
  return base.replace(/\.mdc?$/i, "");
}

// ------------------------------------------------------------------- digest

const USER_LIMIT = 700;
const REPLY_LIMIT = 1100;
const NOTE_LIMIT = 4000;

function clip(text, limit, headShare = 0.7) {
  const t = String(text || "")
    .replace(/^#{1,6}\s+(.+?)\s*$/gm, "【$1】") // keep the digest's own headings unambiguous
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (t.length <= limit) return t;
  const head = Math.floor(limit * headShare);
  const tail = limit - head;
  return `${t.slice(0, head)}\n…（略 ${t.length - limit} 字）…\n${t.slice(t.length - tail)}`;
}

function hhmm(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function renderTurn(turn) {
  const parts = [];
  if (turn.user) parts.push(`他说：${clip(turn.user, USER_LIMIT)}`);
  if (turn.reply) parts.push(`agent 收尾：${clip(turn.reply, REPLY_LIMIT)}`);
  if (turn.note) parts.push(`他存下的一段${turn.from ? `（来自 ${turn.from}）` : ""}：${clip(turn.note, NOTE_LIMIT)}`);
  return parts.join("\n");
}

// Keep a session within `cap` characters by holding on to how it opened and
// how it ended; the middle of a long session is the most skippable part.
function renderSession(session, cap) {
  const rendered = session.turns.map(renderTurn).filter(Boolean);
  let body = rendered.join("\n\n");
  if (body.length > cap && rendered.length > 2) {
    const head = [rendered[0]];
    const tail = [];
    let used = rendered[0].length;
    for (let i = rendered.length - 1; i > 0; i--) {
      if (used + rendered[i].length > cap) break;
      tail.unshift(rendered[i]);
      used += rendered[i].length;
    }
    const skipped = rendered.length - head.length - tail.length;
    body = [...head, skipped > 0 ? `…（中间略 ${skipped} 轮）…` : "", ...tail].filter(Boolean).join("\n\n");
  }
  if (body.length > cap) body = clip(body, cap, 0.5);
  const agent = AGENT_NAME[session.agent] || session.agent;
  const title = session.title ? `《${session.title}》` : "";
  return `### ${agent} ${hhmm(session.firstTs)}–${hhmm(session.lastTs)} ${title}\n${body}`;
}

function buildDigest(sessions, options = {}) {
  const budget = options.budget || 90000;
  const byProject = new Map();
  for (const s of sessions) {
    if (!byProject.has(s.project)) byProject.set(s.project, []);
    byProject.get(s.project).push(s);
  }
  const cap = Math.max(1500, Math.min(16000, Math.floor(budget / Math.max(1, sessions.length))));
  const blocks = [];
  for (const [project, list] of byProject) {
    blocks.push(`## 项目：${project}\n\n${list.map((s) => renderSession(s, cap)).join("\n\n")}`);
  }
  let text = blocks.join("\n\n");
  let truncated = false;
  if (text.length > budget) {
    text = text.slice(0, budget) + "\n…（材料过长，后面的略去）…";
    truncated = true;
  }
  const perAgent = new Map();
  for (const s of sessions) perAgent.set(s.agent, (perAgent.get(s.agent) || 0) + 1);
  return {
    text,
    stats: {
      // Which agents the day's work came from, busiest first.
      agents: [...perAgent.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, name: AGENT_NAME[id] || id, sessions: n })),
      sessions: sessions.length,
      turns: sessions.reduce((n, s) => n + s.turns.filter((t) => t.user || t.note).length, 0),
      projects: byProject.size,
      chars: text.length,
      truncated,
    },
  };
}

module.exports = { settledFrom, buildDigest, clip };
