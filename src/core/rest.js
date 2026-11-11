"use strict";

// Stepping away every so often, and a look back at the stretch before it.
//
// After a set length of work the person is asked to rest. As the rest runs
// out they are shown what they and their agents did in that stretch: which
// things an agent is still on, which wait on them, which are wrapped up. It
// is read straight from the transcripts, with no model involved, so it costs
// nothing and is there the moment it is wanted.
//
// The point is to keep hold of the day. Hours go by inside one thing, and the
// day ends feeling like nothing was done; a look back every hour or so says
// otherwise, or says it early enough to change course.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { dataDir, writeJsonAtomic } = require("./config");
const { AGENT_NAME } = require("./agents");

const MIN = 60 * 1000;
const MAX_THINGS = 6;
const EVERY_CHOICES = [25, 50, 90];
const FOR_CHOICES = [3, 5, 10];
const DEFAULTS = Object.freeze({ enabled: false, everyMin: 50, forMin: 5 });
// Away from the keyboard this long at the moment a rest falls due: not there
// to be asked, so the asking waits.
const AWAY_SECONDS = 120;
// A rest nobody came back from is closed after this long.
const ABANDONED_AFTER = 30 * MIN;
const SNOOZE_MIN = 5;
// An agent known to be mid-turn that has shown no sign of life for this long
// is not running any more: it was stopped, and the thing waits on the person.
const STALLED_AFTER = 15 * MIN;

function settings(cfg) {
  const raw = cfg && cfg.rest && typeof cfg.rest === "object" ? cfg.rest : {};
  const whole = (v, low, high, fallback) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= low && n <= high ? n : fallback;
  };
  return {
    enabled: Boolean(raw.enabled),
    everyMin: whole(raw.everyMin, 1, 240, DEFAULTS.everyMin),
    forMin: whole(raw.forMin, 1, 60, DEFAULTS.forMin),
  };
}

// ------------------------------------------------------------ the look back

function clock(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function clip(text, limit) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > limit ? t.slice(0, limit - 1) + "…" : t;
}

// The first line of a closing message that says something, without its markup.
function gist(reply, limit = 96) {
  for (const raw of String(reply || "").split("\n")) {
    const line = raw
      .replace(/^[\s>#*\-+\d.)、]+/, "")
      .replace(/[*_`]+/g, "")
      .trim();
    if (line.length >= 2) return clip(line, limit);
  }
  return "";
}

// A closing message that ends on a question hands the turn back.
function asksBack(reply) {
  const tail = String(reply || "").trim().split(/\n\s*\n/).pop() || "";
  return /[?？]\s*$/.test(tail.trim()) || /[?？]/.test(tail.slice(-160));
}

// What a stretch of time held: one entry per conversation (or per project,
// for conversations nobody named), newest activity first. Each says where it
// stands: an agent still on it, the agent waiting on an answer, or done.
function blockRecap(sessions, from, to) {
  const groups = new Map();
  let asks = 0;
  for (const s of sessions) {
    // What was asked in the stretch, and what an agent did in it on something
    // asked before: a long job that ran through the stretch belongs in it.
    const turns = s.turns.filter((t) => (t.user || t.reply || t.open) && t.ts >= from && t.ts < to).sort((a, b) => a.ts - b.ts);
    if (!turns.length) continue;
    asks += turns.filter((t) => t.user).length;
    const project = String(s.project || "").split("/").pop() || s.project || "";
    const key = s.title ? `title:${s.title}` : `project:${s.project}`;
    const g = groups.get(key) || { title: s.title || project, project: s.title ? project : "", agent: AGENT_NAME[s.agent] || s.agent, turns: [] };
    g.turns.push(...turns);
    groups.set(key, g);
  }
  const span = Math.max(1, to - from);
  const things = [...groups.values()].map((g) => {
    g.turns.sort((a, b) => a.ts - b.ts);
    const last = g.turns[g.turns.length - 1];
    const asked = g.turns.filter((t) => t.user);
    const reply = last.reply || "";
    // Where the transcript says whether the turn ended, that is what counts:
    // something said along the way is not the agent being done.
    const open = !reply || last.open === true;
    const stalled = last.open === true && last.activeTs > 0 && to - last.activeTs > STALLED_AFTER;
    return {
      title: clip(g.title, 40),
      project: g.project,
      agent: g.agent,
      // None at all when the asking was done before the stretch began.
      asks: asked.length,
      from: clock(g.turns[0].ts),
      to: clock(last.activeTs || last.endTs || last.ts),
      // What set the thing going in this stretch, and, if more was asked
      // since, the latest of it.
      ask: asked.length ? clip(asked[0].user, 72) : "",
      latest: asked.length > 1 ? clip(asked[asked.length - 1].user, 48) : "",
      reply: gist(reply),
      state: open && !stalled ? "running" : stalled || asksBack(reply) ? "waiting" : "done",
      // Where in the stretch each ask fell, for a strip of ticks.
      marks: asked.map((t) => Math.round(((t.ts - from) / span) * 1000) / 1000),
      at: last.activeTs || last.endTs || last.ts,
    };
  });
  things.sort((a, b) => b.at - a.at);
  const shown = things.slice(0, MAX_THINGS);
  const count = (state) => things.filter((t) => t.state === state).length;
  return {
    from: clock(from),
    to: clock(to),
    minutes: Math.max(1, Math.round(span / MIN)),
    asks,
    things: shown.map(({ at, ...rest }) => rest),
    more: things.length - shown.length,
    running: count("running"),
    waiting: count("waiting"),
    done: count("done"),
  };
}

// --------------------------------------------------------------- the timer

// Seconds since the keyboard or pointer was last touched; null where that
// cannot be asked without extra permissions (anything but macOS).
function idleSeconds() {
  if (process.platform !== "darwin") return null;
  try {
    const out = spawnSync("ioreg", ["-c", "IOHIDSystem"], { encoding: "utf8", timeout: 1500 }).stdout || "";
    const m = /"HIDIdleTime"\s*=\s*(\d+)/.exec(out);
    return m ? Number(m[1]) / 1e9 : null;
  } catch {
    return null;
  }
}

function stateFile() {
  return path.join(dataDir(), "rest.json");
}

function dayOf(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadState(now) {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    if (s && s.day === dayOf(now)) return { day: s.day, count: Number(s.count) || 0, lastEnd: Number(s.lastEnd) || 0 };
  } catch {
    // nothing kept yet
  }
  return { day: dayOf(now), count: 0, lastEnd: 0 };
}

// One per host (the web server, the desktop shell). `collect(from, to)`
// returns the sessions with asks in that stretch; `getConfig` / `saveConfig`
// read and change the settings; `onDue` is told when a rest begins by itself.
function createRest(options) {
  const now = options.now || (() => Date.now());
  const idle = options.idle || idleSeconds;
  const onDue = options.onDue || (() => {});
  const conf = () => settings(options.getConfig());

  let kept = loadState(now());
  let phase = "idle"; // idle | resting
  let startedAt = 0;
  let endsAt = 0;
  let from = 0; // where the stretch being looked back on began
  // The stretch of work now running began here.
  let blockFrom = Math.max(kept.lastEnd, now());
  let snoozeUntil = 0;
  let checking = false;

  function save() {
    try {
      writeJsonAtomic(stateFile(), kept);
    } catch {
      // only a convenience across restarts
    }
  }

  function today() {
    if (kept.day !== dayOf(now())) kept = { day: dayOf(now()), count: 0, lastEnd: kept.lastEnd };
    return kept;
  }

  function begin(blockStart) {
    const c = conf();
    phase = "resting";
    startedAt = now();
    endsAt = startedAt + c.forMin * MIN;
    from = blockStart;
  }

  function end(counted) {
    phase = "idle";
    snoozeUntil = 0;
    blockFrom = now();
    today().lastEnd = blockFrom;
    if (counted) kept.count++;
    save();
  }

  // Called every half minute or so by whatever hosts this. Starts a rest
  // when one is due, and tidies up one nobody came back from.
  async function tick() {
    const t = now();
    if (phase === "resting") {
      if (t > endsAt + ABANDONED_AFTER) end(true);
      return status();
    }
    const c = conf();
    if (!c.enabled || checking) return status();
    const away = idle();
    // Away for as long as a rest lasts: that was one. The stretch starts
    // over when they are back.
    if (away != null && away >= c.forMin * 60) {
      blockFrom = t;
      return status();
    }
    if (t < snoozeUntil || t - blockFrom < c.everyMin * MIN) return status();
    if (away != null && away >= AWAY_SECONDS) return status();
    checking = true;
    try {
      const sessions = await options.collect(blockFrom, t);
      const first = Math.min(...sessions.flatMap((s) => s.turns.filter((x) => x.user && x.ts >= blockFrom && x.ts < t).map((x) => x.ts)));
      if (!Number.isFinite(first)) {
        blockFrom = t; // nothing was asked of an agent: not a stretch of work
      } else if (t - first < c.everyMin * MIN && !snoozeUntil) {
        blockFrom = first; // the work began later than the watching did
      } else if (phase === "idle") {
        begin(first);
        onDue(status());
      }
    } catch {
      blockFrom = t; // unreadable right now: try again a stretch from here
    } finally {
      checking = false;
    }
    return status();
  }

  function status() {
    const c = conf();
    const t = now();
    return {
      ...c,
      choices: { every: EVERY_CHOICES, for: FOR_CHOICES },
      phase,
      now: t,
      startedAt: phase === "resting" ? startedAt : 0,
      endsAt: phase === "resting" ? endsAt : 0,
      // When the next one is expected, as far as can be told now.
      dueAt: c.enabled && phase === "idle" ? Math.max(snoozeUntil, blockFrom + c.everyMin * MIN) : 0,
      count: today().count,
    };
  }

  return {
    tick,
    status,

    // What the stretch before this rest held, as of now: an agent that was
    // still running when the rest began may have finished during it.
    async recap() {
      if (phase !== "resting") return null;
      const upTo = now();
      const recap = blockRecap(await options.collect(from, upTo), from, upTo);
      return { ...recap, minutes: Math.max(1, Math.round((startedAt - from) / MIN)), to: clock(startedAt) };
    },

    // Asked for by hand: look back over one stretch's worth, or to the last
    // rest if that was more recent.
    start() {
      if (phase !== "resting") begin(Math.max(kept.lastEnd, now() - conf().everyMin * MIN));
      return status();
    },

    skip() {
      if (phase === "resting") end(false);
      return status();
    },

    snooze() {
      if (phase === "resting") {
        phase = "idle";
        snoozeUntil = now() + SNOOZE_MIN * MIN;
      }
      return status();
    },

    done() {
      if (phase === "resting") end(true);
      return status();
    },

    set(patch) {
      const next = { ...conf() };
      if (patch && typeof patch === "object") {
        if ("enabled" in patch) next.enabled = Boolean(patch.enabled);
        if ("everyMin" in patch) next.everyMin = patch.everyMin;
        if ("forMin" in patch) next.forMin = patch.forMin;
      }
      const clean = settings({ rest: next });
      const was = conf();
      options.saveConfig({ rest: clean });
      // Counting starts from the moment it is switched on.
      if (clean.enabled && !was.enabled) {
        blockFrom = now();
        snoozeUntil = 0;
      }
      return status();
    },
  };
}

module.exports = { DEFAULTS, SNOOZE_MIN, settings, blockRecap, gist, asksBack, idleSeconds, createRest };
