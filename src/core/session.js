"use strict";

// What the interface can ask for, independent of what hosts it. The desktop
// shell answers the page over IPC and the local web server answers it over
// HTTP; both hand the request to one of these.

const fs = require("fs");
const path = require("path");

const config = require("./config");
const ledger = require("./ledger");
const library = require("./library");
const dotjar = require("./dotjar");
const { engines } = require("./distill");
const { dayWindow } = require("./sources");

function createSession(options = {}) {
  let cfg = config.load();
  // "zh" or "en": what kept notes and the library page are written in.
  const language = options.language || config.resolveLanguage(cfg);
  let lastScan = null; // the most recent scan, reused to answer keep / skip without rescanning
  let distilling = null;
  const onView = options.onView || (() => {});
  // Where an undone note goes. Never deleted outright.
  const discard = options.discard || moveToDotjarTrash;

  function present(view) {
    onView(view);
    return view;
  }

  function rebuildLibrary() {
    try {
      return library.build(cfg, new Date(), language);
    } catch (err) {
      console.error(`汇总页没能生成：${err.message}`);
      return null;
    }
  }

  // The day to show: a key like "2026-10-12" once one has been picked,
  // otherwise whichever the scan settles on (today, or yesterday first thing
  // in the morning). A pick sticks until another is made; "auto" clears it.
  let picked;

  async function today(pick) {
    if (pick === "auto") picked = undefined;
    else if (typeof pick === "string" && /^\d{4}-\d{2}-\d{2}$/.test(pick)) picked = pick;
    lastScan = await dotjar.scan(cfg, new Date(), { day: picked });
    rebuildLibrary();
    return present(dotjar.view(cfg, lastScan));
  }

  // A decision may land in an earlier day's ledger (a candidate carried over),
  // so the day on screen is read back rather than assumed.
  function afterEdit() {
    if (!lastScan) return today();
    lastScan = { ...lastScan, day: ledger.loadDay(lastScan.window.key) };
    rebuildLibrary();
    return present(dotjar.view(cfg, lastScan));
  }

  function dayKey() {
    if (!lastScan) throw new Error("还没有读到今天的数据");
    return lastScan.window.key;
  }

  // Go through the day on screen, or several picked days one after another.
  let progress = null; // { done, total, day } while a batch runs
  function distill(days) {
    if (distilling) return distilling;
    const valid = (k) => typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k);
    const list = Array.isArray(days) && days.some(valid) ? [...new Set(days.filter(valid))].sort() : null;
    if (!list) {
      progress = { done: 0, total: 1, day: lastScan ? lastScan.window.key : picked || null };
      distilling = dotjar
        .distillToday(cfg, { language, day: lastScan ? lastScan.window.key : picked })
        .then(async (res) => ({ view: await today(), found: res.found, again: res.again, costUsd: res.costUsd, days: 1, failed: [] }));
    } else {
      progress = { done: 0, total: list.length, day: list[0] };
      distilling = (async () => {
        let found = 0;
        const failed = [];
        for (const day of list) {
          progress.day = day;
          try {
            found += (await dotjar.distillToday(cfg, { language, day })).found;
          } catch (err) {
            failed.push({ day, error: err.message, code: err.code });
          }
          progress.done++;
        }
        return { view: await today(), found, days: list.length, failed };
      })();
    }
    distilling = distilling.finally(() => {
      distilling = null;
      progress = null;
    });
    return distilling;
  }

  // Counts of work per day for months that are over do not change; keep them.
  const pastMonths = new Map();

  return {
    get config() {
      return cfg;
    },
    today,
    distill,
    isDistilling: () => (progress ? { ...progress } : false),
    async calendar(month) {
      const now = new Date();
      const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const cached = month < thisMonth ? pastMonths.get(month) : null;
      const result = await dotjar.calendar(cfg, month, new Date(), cached || null);
      if (month < thisMonth) pastMonths.set(month, result.activity);
      delete result.activity;
      return result;
    },

    keep(id) {
      ledger.keep(ledger.dayOf(id, dayKey()), id, config.depositDir(cfg), language);
      return afterEdit();
    },

    skip(id) {
      ledger.skip(ledger.dayOf(id, dayKey()), id);
      return afterEdit();
    },

    async reopen(id) {
      const { file } = ledger.reopen(ledger.dayOf(id, dayKey()), id);
      if (file && fs.existsSync(file)) await Promise.resolve(discard(file)).catch(() => {});
      return afterEdit();
    },

    // Add text from anywhere to today's material.
    capture(text, from) {
      if (!text || !String(text).trim()) throw new Error("没有可存的文字");
      dotjar.capture(String(text), { from }, cfg);
      return today();
    },

    setDepositDir(dir) {
      const target = config.expandHome(String(dir || "").trim());
      if (!target || !path.isAbsolute(target)) throw new Error("请填写完整的文件夹路径，例如 ~/笔记/收件箱");
      fs.mkdirSync(target, { recursive: true });
      cfg = config.save({ depositDir: target });
      rebuildLibrary();
      return lastScan ? dotjar.view(cfg, lastScan) : today();
    },

    library: () => {
      const file = rebuildLibrary();
      if (!file) throw new Error("汇总页没能生成");
      return file;
    },

    // Out of the library. A kept note is set aside in dotjar's trash and its
    // candidate counts as passed over; something an agent wrote is only no
    // longer listed, its file untouched. Returns what puts it back.
    removeFromLibrary(file) {
      if (typeof file !== "string" || !path.isAbsolute(file)) throw new Error("没有这个条目");
      const kept = ledger.findKept(file);
      const inStore = path.dirname(file) === config.depositDir(cfg) && /\.(md|markdown)$/i.test(file);
      if (kept || inStore) {
        if (!fs.existsSync(file)) throw new Error("这篇笔记已经不在了");
        const setAside = moveToDotjarTrash(file);
        if (kept) ledger.markRemoved(kept.day, kept.id, setAside);
        rebuildLibrary();
        return { file, setAside, ...(kept || {}) };
      }
      ledger.setHidden(file, true);
      rebuildLibrary();
      return { file, hidden: true };
    },

    restoreToLibrary(undo) {
      if (!undo || typeof undo.file !== "string") throw new Error("没有可撤销的");
      if (undo.hidden) {
        ledger.setHidden(undo.file, false);
      } else {
        const trash = path.join(config.dataDir(), "trash");
        const from = String(undo.setAside || "");
        if (path.dirname(from) !== trash || !fs.existsSync(from)) throw new Error("放回去的那篇已经找不到了");
        if (path.dirname(undo.file) !== config.depositDir(cfg) || fs.existsSync(undo.file)) throw new Error("原来的位置已经有别的文件了");
        fs.renameSync(from, undo.file);
        if (undo.day && undo.id) ledger.markRestored(undo.day, undo.id, undo.file);
      }
      rebuildLibrary();
      return true;
    },

    // A cheap summary for a desktop companion that asks every minute or so:
    // read from today's ledger, no rescanning of transcripts.
    pulse() {
      // The real today, whatever day the page happens to be showing.
      const key = dayWindow(new Date(), cfg.dayStartHour).key;
      const day = ledger.loadDay(key);
      const own = day.items;
      const count = (status) => own.filter((i) => i.status === status).length;
      const dots = own.filter((i) => i.status !== "skipped").map((i) => ({ id: i.id, kind: i.kind, status: i.status }));
      const view = lastScan && lastScan.window.key === key ? dotjar.view(cfg, lastScan) : null;
      return {
        day: key,
        distilledAt: day.distilledAt || null,
        dots,
        open: count("open") + ledger.backlog(key).length,
        kept: count("kept"),
        turnsSince: view ? view.turnsSince : 0,
        distilling: progress ? { ...progress } : false,
      };
    },

    language,
    // Which engine goes through the day, and which others could.
    engine() {
      return { engine: cfg.engine, engineModel: cfg.engine === "openai" ? cfg.api.model || "" : "", engines: engines(cfg) };
    },

    setEngine(id) {
      const choice = engines(cfg).find((e) => e.id === id);
      if (!choice) throw new Error("没有这个选项");
      if (!choice.available) throw new Error(id === "openai" ? "模型接口还没配置" : `这台机器上没找到 ${id === "codex-cli" ? "codex" : "claude"} 命令`);
      cfg = config.save({ engine: id });
      return this.engine();
    },
  };
}

// Outside the desktop shell there is no system trash to hand a file to, so
// an undone note is set aside in the data folder instead.
function moveToDotjarTrash(file) {
  const dir = path.join(config.dataDir(), "trash");
  fs.mkdirSync(dir, { recursive: true });
  let target = path.join(dir, path.basename(file));
  for (let n = 2; fs.existsSync(target); n++) target = path.join(dir, `${path.basename(file, ".md")} ${n}.md`);
  fs.renameSync(file, target);
  return target;
}

module.exports = { createSession, moveToDotjarTrash };
