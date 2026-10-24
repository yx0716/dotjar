"use strict";

// Readers for the other agents that keep their conversations on this machine.
// Each returns sessions in the same shape sources.js builds for Claude Code
// and Codex: what the person asked, and how the agent closed each ask.
//
//   Cursor      ~/.cursor/projects/<project>/agent-transcripts/<id>/<id>.jsonl
//   OpenClaw    ~/.openclaw/agents/<agent>/sessions/<id>.jsonl
//   Gemini CLI  ~/.gemini/tmp/<project>/chats/session-*.json
//   Qwen Code   ~/.qwen/tmp/<project>/chats/session-*.json   (a Gemini CLI fork)
//   opencode    ~/.local/share/opencode/storage/{session,message,part}
//
// Agents that write Claude Code's own transcript format under a different
// folder are listed in CLAUDE_COMPATIBLE and read by the Claude reader.

const fs = require("fs");
const path = require("path");

const CLAUDE_COMPATIBLE = [
  { agent: "claude-code", dir: ".claude" },
  { agent: "claude-internal", dir: ".claude-internal" },
  { agent: "tclaude", dir: ".tclaude" },
  { agent: "codebuddy", dir: ".codebuddy" },
];

const AGENT_NAME = {
  "claude-code": "Claude Code",
  "claude-internal": "Claude Internal",
  tclaude: "tclaude",
  codebuddy: "CodeBuddy",
  codex: "Codex",
  cursor: "Cursor",
  openclaw: "OpenClaw",
  "gemini-cli": "Gemini CLI",
  "qwen-code": "Qwen Code",
  opencode: "opencode",
  inbox: "手动存入",
};

// How many closing turns to keep from a session that began before today and
// whose messages carry no times of their own.
const UNDATED_TAIL = 6;

function list(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function stat(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (typeof c === "string" ? c : c && c.type !== "toolCall" && c.type !== "tool_use" && typeof c.text === "string" ? c.text : ""))
    .filter(Boolean)
    .join("\n");
}

// Folder names like "Users-me-repos-my-app" stand for a path, but a dash can
// be a separator or part of a name; the file system says which.
function decodeDashedPath(name) {
  const tokens = String(name).split("-").filter(Boolean);
  let current = path.sep;
  let i = 0;
  while (i < tokens.length) {
    let next = null;
    for (let j = tokens.length; j > i && !next; j--) {
      const segment = tokens.slice(i, j).join("-");
      for (const candidate of [segment, "." + segment]) {
        if (fs.existsSync(path.join(current, candidate))) {
          next = { dir: path.join(current, candidate), upto: j };
          break;
        }
      }
    }
    if (!next) return "";
    current = next.dir;
    i = next.upto;
  }
  return current;
}

function createReaders(helpers) {
  const { newSession, pushTurn, setReply, cleanHumanText, inWindow } = helpers;

  // --------------------------------------------------------------- Cursor

  function readCursor(home, win) {
    const root = path.join(home, ".cursor", "projects");
    const sessions = [];
    for (const dir of list(root)) {
      const transcripts = path.join(root, dir, "agent-transcripts");
      for (const id of list(transcripts)) {
        const file = path.join(transcripts, id, `${id}.jsonl`);
        const st = stat(file);
        if (!st) continue;
        // No time on any message: a transcript counts toward the day it was
        // last written, or else the day it began, and only those.
        const when = inWindow(st.mtimeMs, win) ? st.mtimeMs : inWindow(st.birthtimeMs, win) ? st.birthtimeMs : null;
        if (when == null) continue;
        const session = newSession("cursor", id);
        session.cwd = decodeDashedPath(dir);
        if (!session.cwd) session.project = dir.split("-").slice(-2).join("-");
        let text;
        try {
          text = fs.readFileSync(file, "utf8");
        } catch {
          continue;
        }
        for (const line of text.split(/\r?\n/)) {
          if (!line) continue;
          let rec;
          try {
            rec = JSON.parse(line);
          } catch {
            continue;
          }
          const body = textOf(rec.message && rec.message.content);
          if (rec.role === "user") {
            // Cursor wraps what was typed; the rest is context it attached.
            const typed = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/.exec(body);
            const ask = cleanHumanText(typed ? typed[1] : body);
            if (ask) pushTurn(session, when, ask);
          } else if (rec.role === "assistant") {
            const reply = body.replace(/\[REDACTED\]/g, "").trim();
            if (reply) setReply(session, when, reply);
          }
        }
        // No per-message times: a session begun earlier contributes its end.
        if (st.birthtimeMs < win.start) session.turns = session.turns.slice(-UNDATED_TAIL);
        sessions.push(session);
      }
    }
    return sessions;
  }

  // ------------------------------------------------------------- OpenClaw

  function readOpenClaw(home, win) {
    const root = path.join(home, ".openclaw", "agents");
    const sessions = [];
    for (const agent of list(root)) {
      const dir = path.join(root, agent, "sessions");
      for (const name of list(dir)) {
        if (!name.endsWith(".jsonl")) continue;
        const file = path.join(dir, name);
        const st = stat(file);
        if (!st || st.mtimeMs < win.start) continue;
        const session = newSession("openclaw", name.replace(/\.jsonl$/, ""));
        let text;
        try {
          text = fs.readFileSync(file, "utf8");
        } catch {
          continue;
        }
        for (const line of text.split(/\r?\n/)) {
          if (!line) continue;
          let rec;
          try {
            rec = JSON.parse(line);
          } catch {
            continue;
          }
          if (rec.type === "session") {
            if (rec.cwd && !session.cwd) session.cwd = rec.cwd;
            continue;
          }
          if (rec.type !== "message" || !rec.message) continue;
          const ts = Date.parse(rec.timestamp);
          if (!inWindow(ts, win)) continue;
          const body = textOf(rec.message.content).trim();
          if (rec.message.role === "user") {
            const ask = cleanHumanText(body);
            if (ask) pushTurn(session, ts, ask);
          } else if (rec.message.role === "assistant" && body) {
            setReply(session, ts, body);
          }
        }
        sessions.push(session);
      }
    }
    return sessions;
  }

  // ------------------------------------------------- Gemini CLI, Qwen Code

  function readGeminiFamily(root, agent, win) {
    const sessions = [];
    const cwdOf = {};
    const projects = readJson(path.join(root, "projects.json"));
    if (projects && projects.projects) for (const [cwd, dirName] of Object.entries(projects.projects)) cwdOf[dirName] = cwd;

    for (const project of list(path.join(root, "tmp"))) {
      const chats = path.join(root, "tmp", project, "chats");
      for (const name of list(chats)) {
        if (!name.startsWith("session-") || !name.endsWith(".json")) continue;
        const file = path.join(chats, name);
        const st = stat(file);
        if (!st || st.mtimeMs < win.start) continue;
        const data = readJson(file);
        if (!data || !Array.isArray(data.messages)) continue;
        const session = newSession(agent, data.sessionId || name.replace(/\.json$/, ""));
        session.cwd = cwdOf[project] || "";
        if (!session.cwd) session.project = project;
        let dated = false;
        for (const msg of data.messages) {
          if (!msg || (msg.type !== "user" && msg.type !== "gemini")) continue;
          const raw = msg.timestamp || msg.ts;
          let ts = typeof raw === "number" ? raw : raw ? Date.parse(raw) : NaN;
          if (Number.isFinite(ts)) {
            dated = true;
            if (!inWindow(ts, win)) continue;
          } else {
            ts = st.mtimeMs;
          }
          const body = (typeof msg.text === "string" ? msg.text : textOf(msg.content)).trim();
          if (msg.type === "user") {
            const ask = cleanHumanText(body);
            if (ask) pushTurn(session, ts, ask);
          } else if (body) {
            setReply(session, ts, body);
          }
        }
        if (!dated && st.birthtimeMs < win.start) session.turns = session.turns.slice(-UNDATED_TAIL);
        sessions.push(session);
      }
    }
    return sessions;
  }

  // -------------------------------------------------------------- opencode

  function readOpencode(storage, win) {
    const sessions = [];
    const partsText = (messageId) =>
      list(path.join(storage, "part", messageId))
        .filter((f) => f.startsWith("prt_") && f.endsWith(".json"))
        .sort()
        .map((f) => readJson(path.join(storage, "part", messageId, f)))
        .filter((p) => p && p.type === "text" && p.text)
        .map((p) => p.text)
        .join("\n")
        .trim();

    for (const project of list(path.join(storage, "session"))) {
      for (const name of list(path.join(storage, "session", project))) {
        if (!name.startsWith("ses_") || !name.endsWith(".json")) continue;
        const meta = readJson(path.join(storage, "session", project, name));
        if (!meta || !meta.id) continue;
        const updated = (meta.time && (meta.time.updated || meta.time.created)) || 0;
        if (updated && updated < win.start) continue;
        const session = newSession("opencode", meta.id);
        session.cwd = meta.directory || "";
        session.title = meta.title || "";
        const messages = list(path.join(storage, "message", meta.id))
          .filter((f) => f.startsWith("msg_") && f.endsWith(".json"))
          .map((f) => readJson(path.join(storage, "message", meta.id, f)))
          .filter((m) => m && (m.role === "user" || m.role === "assistant"))
          .sort((a, b) => ((a.time && a.time.created) || 0) - ((b.time && b.time.created) || 0));
        for (const m of messages) {
          const ts = (m.time && m.time.created) || updated;
          if (!inWindow(ts, win)) continue;
          const body = partsText(m.id);
          if (!body) continue;
          if (m.role === "user") {
            const ask = cleanHumanText(body);
            if (ask) pushTurn(session, ts, ask);
          } else {
            setReply(session, ts, body);
          }
        }
        sessions.push(session);
      }
    }
    return sessions;
  }

  function readAll(home, win) {
    const xdg = process.env.XDG_DATA_HOME;
    const opencodeRoots = [path.join(home, ".local", "share", "opencode", "storage"), xdg ? path.join(xdg, "opencode", "storage") : null].filter(Boolean);
    return [
      ...readCursor(home, win),
      ...readOpenClaw(home, win),
      ...readGeminiFamily(path.join(home, ".gemini"), "gemini-cli", win),
      ...readGeminiFamily(path.join(home, ".qwen"), "qwen-code", win),
      ...[...new Set(opencodeRoots)].flatMap((root) => readOpencode(root, win)),
    ];
  }

  return { readAll, readCursor, readOpenClaw, readGeminiFamily, readOpencode };
}

module.exports = { CLAUDE_COMPATIBLE, AGENT_NAME, createReaders, decodeDashedPath, textOf };
