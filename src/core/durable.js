"use strict";

// Decides whether a file an agent wrote today is a durable deposit, i.e.
// something that keeps paying off after the session ends, and which kind:
//
//   note    a note in a knowledge base (any Obsidian vault, or a configured dir)
//   rule    standing instructions for agents (CLAUDE.md, AGENTS.md, rules/)
//   skill   a packaged procedure (skills/, commands/, agents/)
//   memory  an agent's own long-term memory file

const fs = require("fs");
const os = require("os");
const path = require("path");

const KINDS = ["note", "rule", "skill", "memory"];

const RULE_FILES = new Set(["claude.md", "claude.local.md", "agents.md", "gemini.md"]);

function createClassifier(options = {}) {
  const home = options.home || os.homedir();
  const noteDirs = (options.noteDirs || []).map((d) => path.resolve(d));
  const exists = options.exists || ((p) => fs.existsSync(p));
  const vaultCache = new Map();

  // Nearest ancestor that contains an `.obsidian` folder, or null.
  function vaultRoot(dir) {
    if (vaultCache.has(dir)) return vaultCache.get(dir);
    let found = null;
    if (exists(path.join(dir, ".obsidian"))) {
      found = dir;
    } else {
      const parent = path.dirname(dir);
      if (parent !== dir) found = vaultRoot(parent);
    }
    vaultCache.set(dir, found);
    return found;
  }

  function classify(filePath) {
    if (!filePath || !path.isAbsolute(filePath)) return null;
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== ".md" && ext !== ".mdc") return null;
    const base = path.basename(filePath).toLowerCase();
    const segments = filePath.split(path.sep);
    const has = (name) => segments.includes(name);

    if (has("node_modules") || has(".git")) return null;

    if (has("memory") && (has(".claude") || has(".codex"))) {
      if (base === "memory.md") return null; // the index, not a memory
      return { kind: "memory", where: memoryWhere(segments) };
    }

    if (has("skills") || ((has("commands") || has("agents")) && has(".claude"))) {
      const anchor = Math.max(segments.lastIndexOf("skills"), segments.lastIndexOf("commands"), segments.lastIndexOf("agents"));
      const name = segments[anchor + 1] || base;
      return { kind: "skill", where: name.replace(/\.mdc?$/i, "") };
    }

    if (RULE_FILES.has(base) || (has("rules") && (has(".claude") || has(".cursor")))) {
      return { kind: "rule", where: ruleWhere(filePath, home) };
    }

    const dir = path.dirname(filePath);
    const vault = vaultRoot(dir);
    if (vault) {
      const rel = path.relative(vault, filePath);
      if (rel.startsWith(".obsidian")) return null;
      return { kind: "note", where: path.dirname(rel) === "." ? path.basename(vault) : path.dirname(rel) };
    }
    for (const root of noteDirs) {
      if (filePath.startsWith(root + path.sep)) {
        const rel = path.relative(root, filePath);
        return { kind: "note", where: path.dirname(rel) === "." ? path.basename(root) : path.dirname(rel) };
      }
    }
    return null;
  }

  return { classify };
}

function memoryWhere(segments) {
  // ~/.claude/projects/-Users-me-repos-foo/memory/x.md → "foo"
  const i = segments.lastIndexOf("memory");
  const owner = segments[i - 1] || "";
  const tail = owner.split("-").filter(Boolean).slice(-2).join("-");
  return tail || "memory";
}

function ruleWhere(filePath, home) {
  const dir = path.dirname(filePath);
  if (dir === path.join(home, ".claude") || dir === path.join(home, ".codex")) return "全局";
  return projectLabel(dir, home);
}

// A short, human label for a working directory: the last two path segments,
// with agent worktree suffixes folded back into the repo they belong to.
function projectLabel(cwd, home = os.homedir()) {
  if (!cwd) return "未知项目";
  let p = cwd.replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/, "");
  if (p === home) return "~";
  const parts = p.split(path.sep).filter(Boolean);
  return parts.slice(-2).join("/");
}

// Pull a one-line gist out of the text an edit added: the first heading if
// there is one, otherwise a memory's frontmatter description, otherwise the
// first line of prose.
function gistOf(added) {
  if (!added) return "";
  const lines = String(added).split(/\r?\n/);
  let inFrontmatter = false;
  let description = "";
  let firstProse = "";
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (i === 0 && line === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (line === "---") inFrontmatter = false;
      else if (/^description:/i.test(line)) description = line.replace(/^description:\s*/i, "");
      continue;
    }
    const heading = /^#{1,6}\s+(.+?)\s*#*$/.exec(line);
    if (heading) return cleanGist(heading[1]);
    if (!firstProse && line && !/^[-*>|`]{1,3}$/.test(line) && !line.startsWith("```") && !isLinkLine(line)) firstProse = line;
  }
  return cleanGist(description || firstProse);
}

// A line that only links elsewhere, like an entry added to an index page.
function isLinkLine(line) {
  return (
    String(line)
      .replace(/\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s*/, "")
      .replace(/[\s,，、·|]+/g, "") === "" && /\[/.test(line)
  );
}

function cleanGist(text, limit = 64) {
  let t = String(text || "")
    .replace(/^[-*+]\s+/, "") // a list item's marker
    .replace(/^\d+[.、)]\s*/, "") // "7. 标题" → "标题"
    .replace(/[（(]\s*\d{4}-\d{2}-\d{2}[^）)]*[）)]\s*$/, "") // trailing "（2026-10-13）"
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/^["'“「](.*)["'”」]$/, "$1") // quotes around the whole thing, not one at the end
    .trim();
  t = t.replace(/^(核心结论|结论)\s*[:：]\s*/, "");
  if (t.length > limit) t = t.slice(0, limit - 1) + "…";
  return t;
}

// Lines a unified diff adds, without the `+` markers.
function addedFromUnifiedDiff(diff) {
  if (!diff) return "";
  const out = [];
  for (const line of String(diff).split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) out.push(line.slice(1));
  }
  return out.join("\n");
}

module.exports = { KINDS, createClassifier, projectLabel, gistOf, cleanGist, isLinkLine, addedFromUnifiedDiff };
