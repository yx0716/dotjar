"use strict";

// The ledger: one small JSON file per work day under <dataDir>/days.
// It remembers which candidates were kept or skipped, and a snapshot of what
// agents settled on their own, so past days can be drawn without rescanning.

const fs = require("fs");
const path = require("path");

const { dataDir, writeJsonAtomic } = require("./config");

const words = require("../overlay/words");

const KIND_LABEL = words.copy("zh").kinds;
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

function daysDir() {
  return path.join(dataDir(), "days");
}

function dayFile(key) {
  return path.join(daysDir(), `${key}.json`);
}

function emptyDay(key) {
  return { day: key, distilledAt: null, model: null, costUsd: null, stats: null, items: [], settled: [], tasks: [] };
}

function loadDay(key) {
  try {
    const day = JSON.parse(fs.readFileSync(dayFile(key), "utf8"));
    return {
      ...emptyDay(key),
      ...day,
      items: Array.isArray(day.items) ? day.items : [],
      settled: Array.isArray(day.settled) ? day.settled : [],
      tasks: Array.isArray(day.tasks) ? day.tasks : [],
    };
  } catch {
    return emptyDay(key);
  }
}

function saveDay(day) {
  writeJsonAtomic(dayFile(day.day), day);
  return day;
}

// A fresh distillation replaces the candidates still open. Anything already
// kept or skipped stays as decided, and is not offered again.
// Going through a day again only adds: candidates already on the list stay
// as they are, decided or not, and what comes back new joins them.
function applyDistilled(day, items, meta = {}) {
  const known = new Set(day.items.map((i) => i.id));
  const fresh = items.filter((i) => !known.has(i.id)).map((i) => ({ ...i, status: "open", foundAt: meta.at || Date.now() }));
  return {
    ...day,
    items: [...day.items, ...fresh],
    distilledAt: meta.at || Date.now(),
    model: meta.model || null,
    costUsd: meta.costUsd == null ? null : meta.costUsd,
    stats: meta.stats || day.stats,
    // An older reply without tasks leaves the last known ones in place.
    tasks: Array.isArray(meta.tasks) && meta.tasks.length ? meta.tasks : day.tasks || [],
  };
}

function snapshotSettled(day, settled) {
  return {
    ...day,
    settled: settled.map((s) => ({
      kind: s.kind,
      name: s.name,
      title: (s.gists && s.gists[0]) || s.name,
      gists: s.gists || [],
      more: s.gists ? Math.max(0, s.gists.length - 1) : 0,
      where: s.where,
      path: s.path,
      isNew: Boolean(s.isNew),
      ts: s.ts,
    })),
  };
}

function findItem(day, id) {
  const item = day.items.find((i) => i.id === id);
  if (!item) throw new Error("这条候选已经不在今天的列表里");
  return item;
}

function fileNameFor(title) {
  const clean = String(title)
    .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/, "")
    .trim();
  return (clean || "未命名").slice(0, 60);
}

function uniquePath(dir, stem) {
  let candidate = path.join(dir, `${stem}.md`);
  for (let n = 2; fs.existsSync(candidate); n++) candidate = path.join(dir, `${stem} ${n}.md`);
  return candidate;
}

// `lang` decides the two bits of text the note carries besides the draft:
// its tag and the label on the line saying when it is useful.
function renderDeposit(item, dayKey, lang = "zh") {
  const T = words.copy(lang);
  const kindLabel = String(T.kinds[item.kind] || item.kind).toLowerCase();
  const projects = item.projects && item.projects.length ? `[${item.projects.map((p) => JSON.stringify(p)).join(", ")}]` : "[]";
  const lines = [
    "---",
    `created: ${dayKey}`,
    "source: dotjar",
    `kind: ${item.kind}`,
    `projects: ${projects}`,
    `tags: [dotjar/${kindLabel}]`,
    "---",
    "",
    `# ${item.title}`,
    "",
    item.draft.trim(),
    "",
  ];
  if (item.payoff) lines.push(`**${T.whenLabel}**${lang === "en" ? ": " : "："}${item.payoff}`, "");
  return lines.join("\n");
}

// Write the candidate into the deposit folder and mark it kept.
function keep(dayKey, id, dir, lang = "zh") {
  const day = loadDay(dayKey);
  const item = findItem(day, id);
  if (item.status === "kept" && item.file && fs.existsSync(item.file)) return { day, item };
  fs.mkdirSync(dir, { recursive: true });
  const file = uniquePath(dir, fileNameFor(item.title));
  fs.writeFileSync(file, renderDeposit(item, dayKey, lang), { flag: "wx" });
  item.status = "kept";
  item.keptAt = Date.now();
  item.file = file;
  saveDay(day);
  return { day, item };
}

function skip(dayKey, id) {
  const day = loadDay(dayKey);
  const item = findItem(day, id);
  item.status = "skipped";
  item.skippedAt = Date.now();
  saveDay(day);
  return { day, item };
}

// Back to open. Returns the file a keep had written, so the caller can move
// it to the trash; the ledger itself never deletes a deposit.
function reopen(dayKey, id) {
  const day = loadDay(dayKey);
  const item = findItem(day, id);
  const file = item.status === "kept" ? item.file : null;
  item.status = "open";
  delete item.keptAt;
  delete item.skippedAt;
  delete item.file;
  saveDay(day);
  return { day, item, file };
}

// ------------------------------------------------- taking things out again

// The kept item a note belongs to, in whichever day's ledger holds it.
function findKept(file) {
  for (const key of listDayKeys().reverse()) {
    const item = loadDay(key).items.find((i) => i.status === "kept" && i.file === file);
    if (item) return { day: key, id: item.id };
  }
  return null;
}

// Taken out of the store: it counts as passed over from now on, and
// remembers where its note was set aside so it can be put back.
function markRemoved(dayKey, id, setAside) {
  const day = loadDay(dayKey);
  const item = findItem(day, id);
  item.status = "skipped";
  item.skippedAt = Date.now();
  item.setAside = setAside;
  saveDay(day);
}

function markRestored(dayKey, id, file) {
  const day = loadDay(dayKey);
  const item = findItem(day, id);
  item.status = "kept";
  item.file = file;
  delete item.skippedAt;
  delete item.setAside;
  saveDay(day);
}

// Things agents wrote that the person asked not to see in the library. Their
// files are the person's own and are left alone.
function hiddenFile() {
  return path.join(dataDir(), "hidden.json");
}

function hiddenPaths() {
  try {
    const list = JSON.parse(fs.readFileSync(hiddenFile(), "utf8"));
    return new Set(Array.isArray(list) ? list.filter((p) => typeof p === "string") : []);
  } catch {
    return new Set();
  }
}

function setHidden(file, hidden) {
  const set = hiddenPaths();
  if (hidden) set.add(file);
  else set.delete(file);
  writeJsonAtomic(hiddenFile(), [...set]);
}

function listDayKeys() {
  let names;
  try {
    names = fs.readdirSync(daysDir());
  } catch {
    return [];
  }
  return names.map((n) => (DAY_FILE.exec(n) || [])[1]).filter(Boolean).sort();
}

// How far back undecided candidates are gathered from. Long enough that a
// day gone through weeks later still has its candidates show up.
const CARRY_DAYS = 90;

function keyDaysBefore(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Candidates from the days before `key` that nobody has decided on yet,
// oldest first. Each carries the day it came from. Nothing left undecided
// drops out of sight just because the date changed.
function backlog(key, days = CARRY_DAYS) {
  const from = keyDaysBefore(key, days);
  const out = [];
  for (const k of listDayKeys()) {
    if (k < from || k >= key) continue;
    for (const item of loadDay(k).items) if (item.status === "open") out.push({ ...item, day: k });
  }
  return out;
}

// What was kept or skipped during a stretch of time, whichever day's
// candidates they were.
function decidedBetween(start, end, key, days = CARRY_DAYS) {
  const from = keyDaysBefore(key, days);
  const kept = [];
  let skipped = 0;
  for (const k of listDayKeys()) {
    if (k < from || k > key) continue;
    for (const item of loadDay(k).items) {
      if (item.status === "kept" && item.keptAt >= start && item.keptAt < end) kept.push({ ...item, day: k });
      else if (item.status === "skipped" && item.skippedAt >= start && item.skippedAt < end) skipped++;
    }
  }
  kept.sort((a, b) => b.keptAt - a.keptAt);
  return { kept, skipped };
}

// Which day's ledger holds a candidate, looking back from `key`.
function dayOf(id, key, days = CARRY_DAYS + 1) {
  const from = keyDaysBefore(key, days);
  const keys = listDayKeys().filter((k) => k >= from && k <= key).reverse();
  for (const k of keys) if (loadDay(k).items.some((i) => i.id === id)) return k;
  throw new Error("这条候选已经不在列表里");
}

// The last `count` days ending at `todayKey`, newest first, each with what
// the ledger already knows about it. A day nobody has opened has no ledger yet.
function recentDays(todayKey, count = 8) {
  const known = new Set(listDayKeys());
  const out = [];
  for (let back = 0; back < count; back++) out.push(summary(keyDaysBefore(todayKey, back), known));
  return out;
}

// What the ledger knows about one day, without reading any transcripts.
function summary(key, known = new Set(listDayKeys())) {
  if (!known.has(key)) return { day: key, seen: false, things: 0, open: 0, distilled: false };
  const day = loadDay(key);
  return { day: key, seen: true, things: day.tasks.length, open: day.items.filter((i) => i.status === "open").length, distilled: Boolean(day.distilledAt) };
}

// Every recorded day, oldest first.
function listDays(limit = 400) {
  return listDayKeys().slice(-limit).map(loadDay);
}

function layersOf(day) {
  const kept = day.items.filter((i) => i.status === "kept").map((i) => ({ kind: i.kind, title: i.title, by: "you" }));
  const agent = day.settled.map((s) => ({ kind: s.kind, title: s.title, by: "agent" }));
  return [...agent, ...kept];
}

// Oldest first. Days with nothing settled are left out: no layer formed.
function history(limitDays = 30, uptoKey = null) {
  const keys = listDayKeys().filter((k) => !uptoKey || k <= uptoKey).slice(-limitDays);
  const out = [];
  for (const key of keys) {
    const layers = layersOf(loadDay(key));
    if (layers.length) out.push({ day: key, layers });
  }
  return out;
}

function recentTitles(limitDays = 14, uptoKey = null) {
  const keys = listDayKeys().filter((k) => !uptoKey || k <= uptoKey).slice(-limitDays);
  const kept = [];
  const skipped = [];
  for (const key of keys) {
    for (const item of loadDay(key).items) {
      if (item.status === "kept") kept.push(item.title);
      else if (item.status === "skipped") skipped.push(item.title);
    }
  }
  return { kept: kept.slice(-40), skipped: skipped.slice(-40) };
}

module.exports = {
  KIND_LABEL,
  loadDay,
  saveDay,
  applyDistilled,
  snapshotSettled,
  keep,
  skip,
  reopen,
  backlog,
  decidedBetween,
  dayOf,
  keyDaysBefore,
  recentDays,
  summary,
  listDayKeys,
  listDays,
  history,
  recentTitles,
  renderDeposit,
  fileNameFor,
  findKept,
  markRemoved,
  markRestored,
  hiddenPaths,
  setHidden,
};
