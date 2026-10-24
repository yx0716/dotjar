"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const HOME = os.homedir();

function dataDir() {
  // DOTJAR_HOME wins; STRATA_HOME is its old name. Otherwise ~/.dotjar,
  // unless only the old ~/.strata is there, which is then used as it is.
  const named = process.env.DOTJAR_HOME || process.env.STRATA_HOME;
  if (named) return named;
  const fresh = path.join(HOME, ".dotjar");
  const old = path.join(HOME, ".strata");
  return !fs.existsSync(fresh) && fs.existsSync(old) ? old : fresh;
}

const DEFAULTS = Object.freeze({
  // Global shortcut that lowers and lifts the veil.
  hotkey: "Alt+Shift+S",
  // Global shortcut that adds the clipboard's text to today's material.
  captureHotkey: "Alt+Shift+C",
  // A work day rolls over at this local hour, so 01:00 still counts as "today".
  dayStartHour: 4,
  // Interface language: "zh", "en", or "auto" to follow the system.
  language: "auto",
  // What keeping something is called throughout the app (Chinese only). One of the sets in
  // src/overlay/words.js, e.g. "落库", "落袋", "波点", "归仓".
  wording: "落库",
  // Which engine goes through the day: "claude-cli" (a local `claude`),
  // "codex-cli" (a local `codex`), or "openai" (any OpenAI-compatible
  // endpoint, configured under `api`). Also switchable from the interface.
  engine: "claude-cli",
  // For engine "codex-cli": model (empty = Codex's own default), how hard it
  // thinks, and where the CLI is if not on PATH.
  codexModel: "",
  codexEffort: "low",
  codexPath: "",
  // Model alias passed to `claude --model`.
  model: "sonnet",
  // For engine "openai". The key can live here, or in the environment
  // variable named by apiKeyEnv.
  api: { baseUrl: "", model: "", apiKey: "", apiKeyEnv: "" },
  // Absolute path to the claude CLI. Empty = find it on PATH / common dirs.
  claudePath: "",
  // Where kept items are written as Markdown. Empty = <dataDir>/deposits.
  depositDir: "",
  // Extra folders whose .md files count as notes, besides any Obsidian vault.
  noteDirs: [],
  claudeDir: path.join(HOME, ".claude"),
  codexDir: path.join(HOME, ".codex"),
});

function configPath() {
  return path.join(dataDir(), "config.json");
}

function load() {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    // Missing or unreadable config falls back to defaults.
  }
  const cfg = { ...DEFAULTS, ...(stored && typeof stored === "object" ? stored : {}) };
  if (!Number.isInteger(cfg.dayStartHour) || cfg.dayStartHour < 0 || cfg.dayStartHour > 23) {
    cfg.dayStartHour = DEFAULTS.dayStartHour;
  }
  if (!Array.isArray(cfg.noteDirs)) cfg.noteDirs = [];
  cfg.api = { ...DEFAULTS.api, ...(cfg.api && typeof cfg.api === "object" ? cfg.api : {}) };
  if (!["claude-cli", "codex-cli", "openai"].includes(cfg.engine)) cfg.engine = "claude-cli";
  return cfg;
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

// Persist only the keys that differ from defaults, so new defaults keep applying.
function save(patch) {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(configPath(), "utf8")) || {};
  } catch {
    // Start from an empty file.
  }
  const next = { ...stored, ...patch };
  writeJsonAtomic(configPath(), next);
  return load();
}

// The language the machine itself is set to, as "zh" or "en". A terminal
// often has no LANG at all, so on macOS the system preference is asked too.
let systemLang = null;
function systemLanguage() {
  if (systemLang) return systemLang;
  const fromEnv = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "";
  let found = /^zh/i.test(fromEnv) ? "zh" : /^en/i.test(fromEnv) ? "en" : "";
  if (!found && process.platform === "darwin") {
    try {
      const out = spawnSync("defaults", ["read", "-g", "AppleLanguages"], { encoding: "utf8", timeout: 2000 }).stdout || "";
      const first = /"?([A-Za-z]{2})[-_"A-Za-z]*/.exec(out.replace(/[()\s]/g, ""));
      if (first) found = first[1].toLowerCase() === "zh" ? "zh" : "en";
    } catch {
      // fall through
    }
  }
  if (!found) found = /^zh/i.test(Intl.DateTimeFormat().resolvedOptions().locale) ? "zh" : "en";
  systemLang = found;
  return found;
}

// "zh" or "en" for this config. `hint` is what the host knows about the
// person's language (the desktop shell's locale, say) when the config is auto.
function resolveLanguage(cfg, hint) {
  const set = String((cfg && cfg.language) || "").toLowerCase();
  if (set.startsWith("zh")) return "zh";
  if (set.startsWith("en")) return "en";
  const h = String(hint || "").toLowerCase();
  if (h.startsWith("zh")) return "zh";
  if (h.startsWith("en")) return "en";
  return systemLanguage();
}

function depositDir(cfg) {
  return cfg.depositDir ? expandHome(cfg.depositDir) : path.join(dataDir(), "deposits");
}

function expandHome(p) {
  if (!p) return p;
  if (p === "~") return HOME;
  if (p.startsWith("~/")) return path.join(HOME, p.slice(2));
  return p;
}

function tildify(p) {
  if (!p) return p;
  return p === HOME || p.startsWith(HOME + path.sep) ? "~" + p.slice(HOME.length) : p;
}

module.exports = {
  DEFAULTS,
  HOME,
  dataDir,
  configPath,
  load,
  save,
  depositDir,
  systemLanguage,
  resolveLanguage,
  expandHome,
  tildify,
  writeJsonAtomic,
};
