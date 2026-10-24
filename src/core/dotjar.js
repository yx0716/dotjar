"use strict";

// The app's one service: scan the day, distill it, and shape what the veil
// shows. Used by the Electron main process and by the CLI alike.

const path = require("path");

const config = require("./config");
const ledger = require("./ledger");
const { createClassifier } = require("./durable");
const { collectDay, dayWindow, windowForKey, appendCapture } = require("./sources");
const { settledFrom, buildDigest } = require("./day");
const { distill } = require("./distill");

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function collect(cfg, win) {
  return collectDay({
    window: win,
    claudeDir: config.expandHome(cfg.claudeDir),
    codexDir: config.expandHome(cfg.codexDir),
    home: config.HOME,
    // Where the other agents keep their data (overridable for tests).
    agentHome: cfg.agentHome || config.HOME,
    inboxDir: inboxDir(),
    excludeCwds: [config.dataDir()],
  });
}

// The day to look at. Usually today; but first thing in the morning, before
// any work has been done, it is yesterday that is waiting to be gone through.
// `options.day` asks for one particular day outright ("2026-10-12");
// `options.daysBack` (0 or 1) is the same for today and yesterday.
async function scan(cfg = config.load(), now = new Date(), options = {}) {
  const today = dayWindow(now, cfg.dayStartHour);
  const yesterday = dayWindow(new Date(today.start - 12 * 3600 * 1000), cfg.dayStartHour);
  let asked = options.day || (options.daysBack === 1 ? yesterday.key : options.daysBack === 0 ? today.key : null);
  if (asked && !(/^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today.key)) asked = null; // not a day that has happened
  let win = asked ? windowForKey(asked, cfg.dayStartHour) : today;
  let found = await collect(cfg, win);
  if (!asked && !found.sessions.length) {
    const earlier = await collect(cfg, yesterday);
    if (earlier.sessions.length) {
      win = yesterday;
      found = earlier;
    }
  }
  const daysBack = Math.round((windowForKey(today.key, 12).start - windowForKey(win.key, 12).start) / (24 * 3600 * 1000));
  const { sessions, touched } = found;
  const classifier = createClassifier({ home: config.HOME, noteDirs: cfg.noteDirs.map(config.expandHome) });
  const settled = settledFrom(touched, classifier, { since: win.start });
  const day = ledger.saveDay(ledger.snapshotSettled(ledger.loadDay(win.key), settled));
  // While looking at today: is anything from yesterday still undecided?
  const before = daysBack ? null : ledger.loadDay(yesterday.key);
  const earlier = before && (before.items.length || before.tasks.length) ? { day: yesterday.key, open: before.items.filter((i) => i.status === "open").length } : null;
  return { window: win, sessions, settled, day, daysBack, earlier, todayKey: today.key };
}

function inboxDir() {
  return path.join(config.dataDir(), "inbox");
}

// Add a piece of text to today's material, from any app.
function capture(text, options = {}, cfg = config.load(), now = new Date()) {
  const win = dayWindow(now, cfg.dayStartHour);
  return appendCapture(inboxDir(), win.key, text, { ts: now.getTime(), from: options.from });
}

function dateLabel(key) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return { date: `${m}月${d}日`, weekday: WEEKDAYS[date.getDay()] };
}

function view(cfg, scanned) {
  const { window: win, sessions, day } = scanned;
  const todayKey = scanned.todayKey || dayWindow(new Date(), cfg.dayStartHour).key;
  const older = ledger.backlog(win.key);
  const olderIds = new Set(older.map((i) => i.id));
  const own = day.items.filter((i) => i.status === "open").map((i) => ({ ...i, day: win.key }));
  const decided = ledger.decidedBetween(win.start, win.end, win.key);
  const digest = buildDigest(sessions);
  const turnsSince = day.distilledAt
    ? sessions.reduce((n, s) => n + s.turns.filter((t) => (t.user || t.note) && t.ts > day.distilledAt).length, 0)
    : 0;
  return {
    day: win.key,
    // 1 when this is yesterday, shown because today has no work yet.
    daysBack: scanned.daysBack || 0,
    // Yesterday, if it left something behind, so it can be reached from today.
    earlier: scanned.earlier || null,
    label: dateLabel(win.key),
    stats: {
      sessions: digest.stats.sessions,
      turns: digest.stats.turns,
      projects: digest.stats.projects,
      agents: digest.stats.agents,
    },
    distilledAt: day.distilledAt,
    model: day.model,
    turnsSince,
    // Whatever earlier days left undecided comes first, then this day's own.
    candidates: [...older, ...own.filter((i) => !olderIds.has(i.id))],
    kept: decided.kept.map((i) => ({ ...i, fileLabel: config.tildify(i.file) })),
    skipped: decided.skipped,
    // The real today, so a carried-over card can say "yesterday" truthfully.
    todayKey,
    settled: day.settled,
    // What the day was spent on. Once distilled, each task says which part
    // was the person's own judgement and which was handed to an agent;
    // before that, the projects worked in stand in, sized by how much was asked.
    tasks: day.tasks.length ? day.tasks : roughTasks(sessions),
    tasksAreRough: !day.tasks.length,
    // Everything this day's pass turned up, each beside the task it came from.
    dots: day.tasks.length ? dotsOf(day.items, day.tasks) : [],
    activity: activity(sessions),
    history: ledger.history(30, win.key),
    depositDir: config.tildify(config.depositDir(cfg)),
    hotkey: cfg.hotkey,
  };
}

function clock(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Before the day is gone through: one task per conversation, under the name
// the agent or the person gave it, placed at the hours it ran. Conversations
// without a name are grouped by the project they ran in.
function roughTasks(sessions) {
  const groups = new Map();
  for (const s of sessions) {
    const asks = s.turns.filter((t) => t.user || t.note);
    if (!asks.length) continue;
    const project = s.project.split("/").pop() || s.project;
    const key = s.title ? `title:${s.title}` : `project:${s.project}`;
    const g = groups.get(key) || { title: s.title || project, project: s.title ? project : "", asks: 0, from: Infinity, to: 0 };
    g.asks += asks.length;
    g.from = Math.min(g.from, ...asks.map((t) => t.ts));
    g.to = Math.max(g.to, ...s.turns.map((t) => t.endTs || t.ts));
    groups.set(key, g);
  }
  const top = [...groups.values()].sort((a, b) => b.asks - a.asks).slice(0, 6);
  const most = top.length ? top[0].asks : 1;
  return top.map((g) => ({
    title: g.title,
    project: g.project,
    effort: Math.max(1, Math.round((g.asks / most) * 5)),
    asks: g.asks,
    human: "",
    ai: "",
    share: "",
    from: clock(g.from),
    to: clock(g.to),
  }));
}

// Character pairs of a text, for telling which task an item is about.
function pairsOf(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

// Which task each item came from: the one the model named, or else the one
// whose words it shares the most; -1 when none comes close.
function dotsOf(items, tasks) {
  const words = tasks.map((t) => pairsOf(`${t.title} ${t.human} ${t.ai}`));
  return items.map((item) => {
    let task = tasks.findIndex((t) => item.task && t.title === item.task);
    if (task === -1) {
      // The name the model gave counts too, even when it is a conversation's title rather than a task's.
      const mine = pairsOf(`${item.task || ""} ${item.title} ${item.payoff} ${(item.projects || []).join(" ")} ${String(item.draft || "").slice(0, 400)}`);
      let best = 0;
      words.forEach((w, k) => {
        let hit = 0;
        for (const p of w) if (mine.has(p)) hit++;
        const score = hit / Math.max(1, w.size);
        if (score > best) [best, task] = [score, k];
      });
      if (best < 0.12) task = -1;
    }
    return { id: item.id, kind: item.kind, title: item.title, status: item.status, file: item.file || "", task };
  });
}

// How busy each half hour of the day was: the stream runs wider there.
function activity(sessions) {
  const times = [];
  for (const s of sessions) for (const t of s.turns) if (t.user || t.note) times.push(t.ts);
  if (!times.length) return null;
  const step = 30 * 60 * 1000;
  const start = Math.floor(Math.min(...times) / step) * step;
  const end = Math.ceil((Math.max(...times) + 1) / step) * step;
  const bins = new Array(Math.max(1, Math.round((end - start) / step))).fill(0);
  for (const t of times) bins[Math.min(bins.length - 1, Math.floor((t - start) / step))]++;
  return { from: clock(start), to: clock(end), bins };
}

async function today(cfg = config.load(), now = new Date()) {
  return view(cfg, await scan(cfg, now));
}

async function distillToday(cfg = config.load(), options = {}) {
  const scanned = await scan(cfg, options.now || new Date(), { day: options.day, daysBack: options.daysBack });
  const { window: win, sessions, settled } = scanned;
  if (!sessions.length) {
    const err = new Error("今天还没有和 agent 一起工作的记录，没有可整理的材料。");
    err.code = "NO_WORK";
    throw err;
  }
  const digest = buildDigest(sessions);
  const recent = ledger.recentTitles(14, win.key);
  // Still waiting, from earlier days or from an earlier pass over this one:
  // not to be offered a second time.
  const before = ledger.loadDay(win.key);
  const pending = [...ledger.backlog(win.key), ...before.items.filter((i) => i.status === "open")];
  const pendingIds = new Set(pending.map((i) => i.id));
  const passes = before.distilledAt ? 1 : 0;
  const startedAt = Date.now();
  const res = await distill({
    config: cfg,
    cwd: config.dataDir(),
    dayKey: win.key,
    digest: digest.text,
    settled,
    kept: [...recent.kept, ...pending.map((i) => i.title)],
    skipped: recent.skipped,
    language: options.language,
    signal: options.signal,
    run: options.run,
  });
  // Reload: the person may have kept or skipped something while this ran.
  const day = ledger.saveDay(
    ledger.applyDistilled(ledger.loadDay(win.key), res.items.filter((i) => !pendingIds.has(i.id)), {
      at: startedAt,
      model: res.model,
      costUsd: res.costUsd,
      stats: digest.stats,
      tasks: res.tasks,
    })
  );
  const added = day.items.filter((i) => i.foundAt === startedAt).length;
  // `again`: this day had been gone through before, so what was found is on top of that.
  return { view: view(cfg, { ...scanned, day }), costUsd: res.costUsd, durationMs: res.durationMs, found: added, again: passes > 0 };
}

const pad2 = (n) => String(n).padStart(2, "0");

// How many asks each day of a month had: one pass over everything touched
// since the month began, counted by the day each ask fell on.
async function monthActivity(cfg, month, now = new Date()) {
  const [y, m] = month.split("-").map(Number);
  const today = dayWindow(now, cfg.dayStartHour);
  const start = windowForKey(`${y}-${pad2(m)}-01`, cfg.dayStartHour).start;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad2(m + 1)}-01`;
  const end = Math.min(windowForKey(next, cfg.dayStartHour).start, today.end);
  const asks = {};
  if (start >= end) return asks;
  const { sessions } = await collect(cfg, { key: `${month}-01`, start, end });
  for (const s of sessions) {
    for (const t of s.turns) {
      if (!t.user && !t.note) continue;
      const key = dayWindow(new Date(t.ts), cfg.dayStartHour).key;
      asks[key] = (asks[key] || 0) + 1;
    }
  }
  return asks;
}

// A month laid out for the calendar: every day, with how much work it had
// and what has already been done with it. `activity` can be passed in when
// the counts for a finished month are already known.
async function calendar(cfg, month, now = new Date(), activity = null) {
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new Error("月份要写成 2026-10 这样");
  const asks = activity || (await monthActivity(cfg, month, now));
  const todayKey = dayWindow(now, cfg.dayStartHour).key;
  const [y, m] = month.split("-").map(Number);
  const known = new Set(ledger.listDayKeys());
  const days = [];
  for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) {
    const key = `${month}-${pad2(d)}`;
    days.push({ ...ledger.summary(key, known), asks: asks[key] || 0, future: key > todayKey });
  }
  return { month, todayKey, days, activity: asks };
}

module.exports = { scan, view, today, distillToday, capture, inboxDir, dateLabel, monthActivity, calendar };
