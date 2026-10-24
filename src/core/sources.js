"use strict";

// Reads one work day out of the local agent transcripts.
//
// Only two things are kept from each session:
//   turns    what the person asked, and the agent's closing message for that ask
//   touched  files the agent wrote, with the text it added
//
// Tool calls, tool output, thinking and automated sessions are dropped: the
// point is what the day left behind, not a replay of it.

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const { projectLabel, addedFromUnifiedDiff } = require("./durable");
const { CLAUDE_COMPATIBLE, createReaders } = require("./agents");

const DAY_MS = 24 * 3600 * 1000;
const ADDED_LIMIT = 4000;

function pad(n) {
  return String(n).padStart(2, "0");
}

function dayWindow(now = new Date(), startHour = 4) {
  const d = new Date(now);
  if (d.getHours() < startHour) d.setDate(d.getDate() - 1);
  d.setHours(startHour, 0, 0, 0);
  const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  return { key, start: d.getTime(), end: next.getTime() };
}

function windowForKey(key, startHour = 4) {
  const [y, m, day] = key.split("-").map(Number);
  const d = new Date(y, m - 1, day, startHour, 0, 0, 0);
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  return { key, start: d.getTime(), end: next.getTime() };
}

async function eachLine(file, onLine) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line) onLine(line);
  }
}

function inWindow(ts, win) {
  return Number.isFinite(ts) && ts >= win.start && ts < win.end;
}

// ---------------------------------------------------------------- Claude Code

const CLAUDE_WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const INJECTED_BLOCKS = /<(system-reminder|ide_opened_file|ide_selection|command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|task-notification|in-app-browser-context|app-context|environment_context)\b[^>]*>[\s\S]*?<\/\1>/g;

// Codex asks its questions in its own UI; the answers come back as JSON.
const QUESTION_REPLY = /<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>/g;

function questionReply(_match, body) {
  let replies;
  try {
    replies = JSON.parse(body);
  } catch {
    return "";
  }
  return [].concat(replies || [])
    .filter((r) => r && r.answer)
    .map((r) => (r.question ? `${r.answer}（回答：${r.question}）` : String(r.answer)))
    .join("\n");
}

function cleanHumanText(text) {
  let t = String(text || "").replace(INJECTED_BLOCKS, "").replace(QUESTION_REPLY, questionReply);
  // Codex desktop prefixes attachments and ambient UI state, then the ask.
  const ask = t.lastIndexOf("## My request:");
  if (ask !== -1) t = t.slice(ask + "## My request:".length);
  t = t.trim();
  if (!t) return "";
  if (t.startsWith("[Request interrupted")) return "";
  if (t.startsWith("[clawd-analytics-internal")) return "";
  if (t.startsWith(DOTJAR_MARKER) || t.startsWith("[strata-distill]")) return ""; // and the marker from before the rename
  // Written by the agent when a conversation ran out of room. It retells
  // earlier work, often from another day, and nobody typed it.
  if (t.startsWith("This session is being continued from a previous conversation")) return "";
  if (/^<[a-z-]+>/.test(t) && t.length < 400) return ""; // a leftover harness tag
  return t;
}

// Marker line prepended to dotjar's own distillation prompt, so a transcript
// of it (if one is ever persisted) is not read back as the person's work.
const DOTJAR_MARKER = "[dotjar-distill]";

function claudeHumanText(rec) {
  if (rec.isMeta || rec.isSidechain || rec.isCompactSummary || !rec.message) return "";
  if (rec.origin) {
    if (rec.origin.kind !== "human") return "";
  } else if (typeof rec.entrypoint === "string" && rec.entrypoint.startsWith("sdk")) {
    return ""; // headless run with no human origin: another tool driving the CLI
  }
  const c = rec.message.content;
  let text = "";
  if (typeof c === "string") text = c;
  else if (Array.isArray(c)) text = c.filter((b) => b && b.type === "text").map((b) => b.text).join("\n");
  return cleanHumanText(text);
}

function claudeAdded(name, input) {
  if (!input) return "";
  if (name === "Write") return String(input.content || "");
  if (name === "Edit") return String(input.new_string || "");
  if (name === "MultiEdit" && Array.isArray(input.edits)) return input.edits.map((e) => e.new_string || "").join("\n");
  if (name === "NotebookEdit") return String(input.new_source || "");
  return "";
}

async function readClaudeSession(file, win, seen = new Set(), agent = "claude-code") {
  const session = newSession(agent, path.basename(file, ".jsonl"));
  // A title the person (or the desktop app) gave wins over the generated one.
  let named = false;
  await eachLine(file, (line) => {
    // Tool results are the bulk of a transcript and carry nothing we keep.
    if (line.includes('"tool_use_id"')) return;
    const isMsg = line.includes('"type":"user"') || line.includes('"type":"assistant"');
    const isTitle = line.includes('"ai-title"') || line.includes('"custom-title"');
    if (!isMsg && !isTitle) return;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      return;
    }
    if (rec.type === "custom-title") {
      if (rec.customTitle) {
        session.title = rec.customTitle;
        named = true;
      }
      return;
    }
    if (rec.type === "ai-title") {
      if (rec.aiTitle && !named) session.title = rec.aiTitle;
      return;
    }
    const ts = Date.parse(rec.timestamp);
    if (!inWindow(ts, win)) return;
    // A resumed session starts as a copy of the one it continues.
    if (rec.uuid) {
      if (seen.has(rec.uuid)) return;
      seen.add(rec.uuid);
    }
    // Where the session started; later `cd`s do not move the project.
    if (rec.cwd && !session.cwd) session.cwd = rec.cwd;

    if (rec.type === "user") {
      const text = claudeHumanText(rec);
      if (text) pushTurn(session, ts, text);
      return;
    }
    if (rec.type !== "assistant" || rec.isSidechain || !rec.message) return;
    if (rec.message.model === "<synthetic>") return;
    const blocks = Array.isArray(rec.message.content) ? rec.message.content : [];
    for (const b of blocks) {
      if (!b) continue;
      if (b.type === "text" && b.text && b.text.trim()) {
        setReply(session, ts, b.text.trim());
      } else if (b.type === "tool_use" && CLAUDE_WRITE_TOOLS.has(b.name)) {
        const input = b.input || {};
        const filePath = input.file_path || input.notebook_path;
        if (!filePath) continue;
        session.touched.push({
          path: resolvePath(filePath, session.cwd),
          action: b.name === "Write" ? "write" : "update",
          added: claudeAdded(b.name, input).slice(0, ADDED_LIMIT),
          ts,
        });
      }
    }
  });
  return session;
}

function listClaudeTranscripts(claudeDir, win) {
  const root = path.join(claudeDir, "projects");
  const out = [];
  let dirs;
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(root, d.name);
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const file = path.join(dir, f);
      if (touchedSince(file, win.start)) out.push(file);
    }
  }
  return out;
}

// ---------------------------------------------------------------------- Codex

function codexText(item) {
  if (!item) return "";
  if (typeof item.text === "string") return item.text;
  if (Array.isArray(item.content)) return item.content.map((c) => (c && c.text) || "").join("\n");
  return "";
}

async function readCodexSession(file, win) {
  const session = newSession("codex", path.basename(file, ".jsonl").replace(/^rollout-[\dT-]+?-(?=[0-9a-f]{8}-)/, ""));
  let subagent = false;
  await eachLine(file, (line) => {
    const wanted =
      line.includes('"session_meta"') ||
      line.includes('"task_complete"') ||
      line.includes('"type":"UserMessage"') ||
      line.includes('"type":"AgentMessage"') ||
      line.includes('"type":"FileChange"');
    if (!wanted) return;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      return;
    }
    const p = rec.payload || {};
    if (rec.type === "session_meta") {
      if (p.cwd && !session.cwd) session.cwd = p.cwd;
      const src = p.thread_source || p.source;
      if (src && typeof src === "object" ? "subagent" in src : /subagent|sub_agent/i.test(String(src || ""))) subagent = true;
      return;
    }
    if (rec.type !== "event_msg") return;
    const ts = Date.parse(rec.timestamp);
    if (!inWindow(ts, win)) return;

    if (p.type === "task_complete") {
      if (p.last_agent_message) setReply(session, ts, String(p.last_agent_message).trim());
      return;
    }
    if (p.type !== "item_completed" || !p.item) return;
    const item = p.item;
    if (item.type === "UserMessage") {
      const text = cleanHumanText(codexText(item));
      if (text) pushTurn(session, ts, text);
    } else if (item.type === "AgentMessage") {
      // Provisional: overwritten by task_complete when the turn finishes.
      const text = codexText(item).trim();
      if (text) setReply(session, ts, text);
    } else if (item.type === "FileChange" && item.changes && typeof item.changes === "object") {
      for (const [filePath, change] of Object.entries(item.changes)) {
        const kind = change && change.type;
        if (kind === "delete") continue;
        session.touched.push({
          path: resolvePath((change && change.move_path) || filePath, session.cwd),
          action: kind === "add" ? "write" : "update",
          added: addedFromUnifiedDiff(change && (change.unified_diff || change.content || "")).slice(0, ADDED_LIMIT) ||
            String((change && change.content) || "").slice(0, ADDED_LIMIT),
          ts,
        });
      }
    }
  });
  return subagent ? null : session;
}

// Codex keeps each conversation's name in an index beside the rollouts; a
// renamed conversation gets a new line, so the last one counts.
function codexTitles(codexDir) {
  const titles = new Map();
  let text;
  try {
    text = fs.readFileSync(path.join(codexDir, "session_index.jsonl"), "utf8");
  } catch {
    return titles;
  }
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.id && rec.thread_name) titles.set(rec.id, String(rec.thread_name));
    } catch {
      // a line being written right now
    }
  }
  return titles;
}

function listCodexRollouts(codexDir, win) {
  const root = path.join(codexDir, "sessions");
  const out = [];
  // Rollouts are filed under the day a session started; a long session keeps
  // appending, so look back a week and let mtime decide.
  for (let back = 0; back <= 7; back++) {
    const d = new Date(win.start - back * DAY_MS + 12 * 3600 * 1000);
    for (const day of [d, new Date(d.getTime() + DAY_MS)]) {
      const dir = path.join(root, String(day.getFullYear()), pad(day.getMonth() + 1), pad(day.getDate()));
      let files;
      try {
        files = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.startsWith("rollout-") || !f.endsWith(".jsonl")) continue;
        const file = path.join(dir, f);
        if (!out.includes(file) && touchedSince(file, win.start)) out.push(file);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------- inbox

// Anything the transcripts cannot see: text captured from a chat app, an
// exported conversation, meeting notes. Each capture is one piece of material.
const CAPTURE_MARK = /^<!-- dotjar:capture (\S+)(?: from="([^"]*)")? -->$/;
const INBOX_EXT = new Set([".md", ".txt", ".markdown"]);
const NOTE_LIMIT = 20000;

function captureHeader(ts, from) {
  const safe = String(from || "").replace(/["\n\r]/g, " ").trim();
  return `<!-- dotjar:capture ${new Date(ts).toISOString()}${safe ? ` from="${safe}"` : ""} -->`;
}

function readInbox(inboxDir, win) {
  const session = newSession("inbox", "inbox");
  session.project = "收件箱";
  let files;
  try {
    files = fs.readdirSync(inboxDir);
  } catch {
    return session;
  }
  for (const name of files.sort()) {
    if (!INBOX_EXT.has(path.extname(name).toLowerCase())) continue;
    const file = path.join(inboxDir, name);
    const st = safeStat(file);
    if (!st || !st.isFile() || st.mtimeMs < win.start) continue;
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!text.split("\n").some((l) => CAPTURE_MARK.test(l))) {
      // A file someone dropped in: the whole thing is one piece.
      if (st.mtimeMs < win.end && text.trim()) session.turns.push({ ts: st.mtimeMs, user: "", reply: "", note: text.trim().slice(0, NOTE_LIMIT), from: name });
      continue;
    }
    let current = null;
    const flush = () => {
      if (current && current.lines.join("\n").trim() && inWindow(current.ts, win)) {
        session.turns.push({ ts: current.ts, user: "", reply: "", note: current.lines.join("\n").trim().slice(0, NOTE_LIMIT), from: current.from });
      }
    };
    for (const line of text.split("\n")) {
      const m = CAPTURE_MARK.exec(line);
      if (m) {
        flush();
        current = { ts: Date.parse(m[1]), from: m[2] || "", lines: [] };
      } else if (current) {
        current.lines.push(line);
      }
    }
    flush();
  }
  session.turns.sort((a, b) => a.ts - b.ts);
  return session;
}

// Append one capture to today's inbox file. Returns the file it went into.
function appendCapture(inboxDir, dayKey, text, options = {}) {
  const body = String(text || "").trim();
  if (!body) return null;
  fs.mkdirSync(inboxDir, { recursive: true });
  const file = path.join(inboxDir, `${dayKey}.md`);
  fs.appendFileSync(file, `${captureHeader(options.ts || Date.now(), options.from)}\n${body}\n\n`);
  return file;
}

// --------------------------------------------------------------------- shared

function newSession(agent, id) {
  return { agent, id, cwd: "", title: "", turns: [], touched: [] };
}

function pushTurn(session, ts, user) {
  const last = session.turns[session.turns.length - 1];
  if (last && last.user === user && !last.reply) {
    // The same prompt again with nothing in between: a resend, or a timer.
    last.repeats = (last.repeats || 0) + 1;
    return;
  }
  session.turns.push({ ts, user, reply: "" });
}

function setReply(session, ts, reply) {
  let last = session.turns[session.turns.length - 1];
  if (!last) {
    // The ask was before the window opened (a session carried over midnight).
    last = { ts, user: "", reply: "" };
    session.turns.push(last);
  }
  last.reply = reply;
  last.endTs = ts;
}

function resolvePath(filePath, cwd) {
  if (path.isAbsolute(filePath)) return path.normalize(filePath);
  return cwd ? path.resolve(cwd, filePath) : filePath;
}

function touchedSince(file, since) {
  try {
    return fs.statSync(file).mtimeMs >= since;
  } catch {
    return false;
  }
}

// A session with many turns that all say the same thing is a timer, not work.
function isAutomation(session) {
  const asks = session.turns.flatMap((t) => (t.user ? Array(1 + (t.repeats || 0)).fill(t.user) : []));
  if (asks.length < 4) return false;
  return new Set(asks).size <= Math.max(1, Math.floor(asks.length / 4));
}

// Oldest file first, so a resumed session only contributes what it added.
function byAge(files) {
  return files
    .map((file) => ({ file, birth: (safeStat(file) || {}).birthtimeMs || 0 }))
    .sort((a, b) => a.birth - b.birth)
    .map((x) => x.file);
}

function safeStat(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

const rootCache = new Map();

// The repo or vault a directory belongs to, so sessions started in different
// subfolders of one project are counted as that one project.
function projectRoot(cwd) {
  if (!cwd) return cwd;
  if (rootCache.has(cwd)) return rootCache.get(cwd);
  let root = cwd;
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".git")) || fs.existsSync(path.join(dir, ".obsidian"))) {
      root = dir;
      break;
    }
    if (path.dirname(dir) === dir) break;
  }
  rootCache.set(cwd, root);
  return root;
}

function finalize(session, home) {
  if (session.project) return finalizeTimes(session);
  // A worktree, or the folder that holds them, belongs to the repository.
  const folded = session.cwd.replace(/[\\/](?:\.claude[\\/])?worktrees(?:[\\/].*)?$/, "");
  session.project = projectLabel(projectRoot(folded), home);
  return finalizeTimes(session);
}

function finalizeTimes(session) {
  session.firstTs = session.turns.length ? session.turns[0].ts : null;
  const lastTurn = session.turns[session.turns.length - 1];
  session.lastTs = lastTurn ? lastTurn.endTs || lastTurn.ts : null;
  for (const t of session.touched) t.project = session.project;
  return session;
}

const otherAgents = createReaders({ newSession, pushTurn, setReply, cleanHumanText, inWindow });

async function collectDay(options) {
  const { window: win, claudeDir, codexDir, home, excludeCwds = [] } = options;
  const seen = new Set();
  let titles = null; // Codex conversation names, read once if needed
  // Where the other agents keep their data. Without it only Claude Code,
  // Codex and the inbox are read.
  const agentHome = options.agentHome || null;
  const claudeRoots = [
    { agent: "claude-code", dir: claudeDir },
    ...(agentHome ? CLAUDE_COMPATIBLE.filter((c) => c.agent !== "claude-code").map((c) => ({ agent: c.agent, dir: path.join(agentHome, c.dir) })) : []),
  ];
  const jobs = [
    ...claudeRoots.flatMap((root) => byAge(listClaudeTranscripts(root.dir, win)).map((f) => () => readClaudeSession(f, win, seen, root.agent))),
    ...listCodexRollouts(codexDir, win).map((f) => async () => {
      const session = await readCodexSession(f, win);
      if (!titles) titles = codexTitles(codexDir);
      if (titles.has(session.id)) session.title = titles.get(session.id);
      return session;
    }),
    ...(agentHome ? [() => otherAgents.readAll(agentHome, win)] : []),
    ...(options.inboxDir ? [() => readInbox(options.inboxDir, win)] : []),
  ];
  const sessions = [];
  const touched = [];
  for (const job of jobs) {
    let found;
    try {
      found = await job();
    } catch {
      continue; // one unreadable transcript should not hide the rest of the day
    }
    for (const session of [].concat(found || [])) {
      if (excludeCwds.some((dir) => session.cwd === dir || session.cwd.startsWith(dir + path.sep))) continue;
      finalize(session, home);
      touched.push(...session.touched);
      const asked = session.turns.some((t) => t.user || t.note);
      if (!asked || isAutomation(session)) continue;
      sessions.push(session);
    }
  }
  sessions.sort((a, b) => (a.firstTs || 0) - (b.firstTs || 0));
  return { sessions, touched };
}

module.exports = {
  DOTJAR_MARKER,
  dayWindow,
  windowForKey,
  collectDay,
  readClaudeSession,
  readCodexSession,
  listClaudeTranscripts,
  listCodexRollouts,
  codexTitles,
  readInbox,
  appendCapture,
  otherAgents,
  cleanHumanText,
  isAutomation,
};
