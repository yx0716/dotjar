"use strict";

(function () {
  const { render: renderMarkdown, escapeHtml: esc } = window.DotjarMarkdown;

  // `window.dotjarBridge` comes from the desktop shell's preload script, or
  // from web-bridge.js when the page is served by `dotjar web`. In demo mode,
  // or opened as a plain file, a made-up day stands in for it.
  const host = window.dotjarBridge;
  const api = host && !host.demo ? host : window.DotjarDemo.createBridge(host);
  const inBrowser = Boolean(host && host.web);
  if (!host || host.demo) document.body.classList.add("demo");
  if (inBrowser) document.body.classList.add("web");

  const $ = (id) => document.getElementById(id);
  const el = {
    date: $("date"),
    cal: $("cal"),
    tabs: $("tabs"),
    stage: $("stage"),
    status: $("status"),
    engine: $("pick-engine"),
    library: $("open-library"),
    close: $("put-away"),
  };

  const params = new URLSearchParams(location.search);
  // All the interface's text, in the language and wording in use. Until the
  // host says otherwise, the language is the browser's.
  let T = window.DotjarWords.copy(params.get("lang") || navigator.language, params.get("words"));
  const state = {
    view: null,
    meta: { engine: "claude-cli", engineModel: "", engines: [], hotkey: "Alt+Shift+S", captureHotkey: "Alt+Shift+C", mac: true },
    phase: "loading", // loading | ready | distilling
    error: null,
    // today: the day at a glance · open: candidates, one at a time · settled: what is kept
    tab: ["open", "settled"].includes(params.get("view")) ? params.get("view") : "today",
    focusId: null,
    toast: null, // { text, undoId }
    distillStart: 0,
    busy: false,
    pick: undefined, // a day to look at ("2026-10-12"); undefined: today, or whichever has work
    switching: false,
    // The calendar under the date: which month it shows, what it knows, what is ticked.
    cal: { open: false, month: "", data: null, loading: false, ticked: new Set() },
    batch: null, // { done, total, day } while picked days are being gone through
  };
  let ticker = null;
  let toastTimer = null;

  // ------------------------------------------------------------- helpers

  function keyLabel(accelerator) {
    const mac = state.meta.mac;
    return String(accelerator || "")
      .split("+")
      .map((k) => {
        if (k === "Alt") return mac ? "⌥" : "Alt+";
        if (k === "Shift") return mac ? "⇧" : "Shift+";
        if (k === "Command" || k === "Cmd" || k === "CommandOrControl" || k === "CmdOrCtrl") return mac ? "⌘" : "Ctrl+";
        if (k === "Control" || k === "Ctrl") return mac ? "⌃" : "Ctrl+";
        return k;
      })
      .join("");
  }

  // The engine's name as it sits inside a sentence. In Chinese it is spaced
  // where Latin meets Chinese and flush where Chinese meets Chinese.
  function engineInline() {
    const name = String(T.engineFull(state.meta.engine, state.meta.engineModel));
    if (T.lang !== "zh") return name;
    const cjk = /[\u4e00-\u9fff]/;
    return `${cjk.test(name[0] || "") ? "" : " "}${name}${cjk.test(name[name.length - 1] || "") ? "" : " "}`;
  }

  // What went wrong, in the interface's language where it is a known case.
  function errorText(err) {
    if (err && err.code === "DEMO_ONLY") return T.demoOnly;
    return (err && err.code && T.errors[err.code]) || (err && err.message) || String(err);
  }

  function hhmm(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  // Keep both ends of a long path: where it starts and the folder it ends in.
  function shortPath(p, max = 40) {
    const t = String(p || "");
    if (t.length <= max) return t;
    const tail = Math.floor(max * 0.62);
    return `${t.slice(0, max - tail - 1)}…${t.slice(-tail)}`;
  }

  function dayOffset(key, delta) {
    const [y, m, d] = key.split("-").map(Number);
    const date = new Date(y, m - 1, d + delta);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  // Wrap each phrase so a line breaks at punctuation rather than mid-word.
  function phrased(title) {
    return String(title)
      .split(/(?<=[，、；：。！？,;:])/)
      .map((part) => `<span class="ph">${esc(part)}</span>`)
      .join("");
  }

  function candidates() {
    return state.view ? state.view.candidates : [];
  }

  function focused() {
    const list = candidates();
    return list.find((c) => c.id === state.focusId) || list[0] || null;
  }

  function settledRows() {
    const v = state.view;
    if (!v) return [];
    return [
      ...v.kept.map((k) => ({ kind: k.kind, title: k.title, where: T.mine, path: k.file })),
      ...v.settled.map((s) => ({
        kind: s.kind,
        title: s.title,
        where: (s.title !== s.name ? s.name : s.isNew ? T.rowNew : T.rowUpdated) + (s.more ? T.rowMore(s.more) : ""),
        path: s.path,
      })),
    ];
  }

  function reducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pause = (ms) => sleep(reducedMotion() ? 0 : ms);

  function toast(text, undoId) {
    state.toast = { text, undoId: undoId || null };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => {
        state.toast = null;
        renderStatus();
      },
      undoId ? 7000 : 2600
    );
    renderStatus();
  }

  // -------------------------------------------------------------- render

  function render() {
    renderBar();
    renderStage();
    renderStatus();
  }

  function renderBar() {
    const v = state.view;
    document.title = T.title;
    document.documentElement.lang = T.lang === "zh" ? "zh-CN" : "en";
    el.library.innerHTML = `${esc(T.library)} <kbd>L</kbd>`;
    // Offered only when there is a choice: more than one engine on this machine.
    const choices = usableEngines();
    el.engine.hidden = choices.length < 2;
    if (choices.length > 1) {
      const next = choices[(choices.findIndex((e) => e.id === state.meta.engine) + 1) % choices.length];
      el.engine.innerHTML = `${esc(T.engineBtn(T.engineShort(state.meta.engine, state.meta.engineModel)))} <kbd>E</kbd>`;
      el.engine.title = T.engineHint(T.engineShort(next.id, next.model));
    }
    el.close.innerHTML = `${esc(T.close)} <kbd>esc</kbd>`;
    el.close.hidden = inBrowser; // a tab is put away like any other tab
    renderDate(v);
    if (!v) {
      el.tabs.hidden = true;
      return;
    }
    el.tabs.hidden = false;
    const tab = (id, label, n, key) =>
      `<button class="tab" type="button" role="tab" data-tab="${id}" aria-selected="${state.tab === id}" title="${esc(T.tabHint(key))}">${label}${n === null ? "" : `<b>${n}</b>`}</button>`;
    el.tabs.innerHTML = tab("today", esc(T.tabToday), null, "1") + tab("open", esc(T.tabOpen), v.candidates.length, "2") + tab("settled", esc(T.tabDone), settledRows().length, "3");
    if (state.bump) el.tabs.querySelector('.tab[data-tab="settled"] b').classList.add("is-bumped");
    state.bump = false;
  }

  // The date opens a calendar: look at another day, or tick several to go
  // through in one go.
  function renderDate(v) {
    el.date.hidden = !v;
    if (!v) return;
    el.date.innerHTML = `<span>${esc(T.date(v.day))}</span><i class="chev"></i>`;
    el.date.setAttribute("aria-label", T.pickDay);
    el.date.setAttribute("aria-expanded", String(state.cal.open));
  }

  function monthOf(key) {
    return key.slice(0, 7);
  }

  function shiftMonth(month, delta) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function openCal() {
    const v = state.view;
    if (!v || state.cal.open) return;
    state.cal.open = true;
    renderDate(v);
    loadCal(monthOf(v.day));
  }

  function closeCal() {
    if (!state.cal.open) return;
    state.cal.open = false;
    el.cal.hidden = true;
    renderDate(state.view);
  }

  async function loadCal(month) {
    state.cal.month = month;
    state.cal.loading = true;
    renderCal();
    try {
      const data = await api.calendar(month);
      if (state.cal.month !== month) return; // moved on to another month meanwhile
      state.cal.data = data;
    } catch (err) {
      toast(errorText(err));
    }
    state.cal.loading = false;
    renderCal();
  }

  function renderCal() {
    const c = state.cal;
    el.cal.hidden = !c.open;
    if (!c.open) return;
    const v = state.view;
    const [y, m] = c.month.split("-").map(Number);
    const data = c.data && c.data.month === c.month ? c.data : null;
    const todayKey = (data && data.todayKey) || v.todayKey || v.day;
    const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday first
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(`<span class="cell is-blank"></span>`);
    const days = data ? data.days : Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => ({ day: `${c.month}-${String(i + 1).padStart(2, "0")}`, future: false }));
    for (const d of days) {
      const n = Number(d.day.slice(8));
      const work = d.asks > 0 || d.things > 0;
      const classes = ["cell", work ? "has-work" : "", d.day === todayKey ? "is-today" : "", d.day === v.day ? "is-current" : "", d.future ? "is-future" : ""].filter(Boolean).join(" ");
      // One short line per day: what is still undecided, else what was done, else that it was never gone through.
      const note = d.open ? T.calOpen(d.open) : d.things ? T.calThings(d.things) : work && !d.distilled ? T.calNotYet : "";
      const ticked = c.ticked.has(d.day);
      cells.push(
        `<span class="${classes}">
          <button class="cell-day" type="button" data-open-day="${d.day}"${d.future ? " disabled" : ""} aria-label="${esc(T.date(d.day))}">
            <b>${n}</b>${note ? `<small${d.open ? ' class="is-open"' : ""}>${esc(note)}</small>` : ""}
          </button>
          ${work && !d.future ? `<button class="tick${ticked ? " is-on" : ""}" type="button" data-tick="${d.day}" aria-pressed="${ticked}" aria-label="${esc(T.calTick(T.date(d.day)))}"></button>` : ""}
        </span>`
      );
    }
    const n = c.ticked.size;
    const canGoForward = c.month < monthOf(todayKey);
    el.cal.innerHTML = `
      <header class="cal-head">
        <button class="cal-nav" type="button" data-month="-1" aria-label="${esc(T.calPrevMonth)}"></button>
        <span class="cal-title">${esc(T.calTitle(y, m))}</span>
        <button class="cal-nav is-next" type="button" data-month="1" aria-label="${esc(T.calNextMonth)}"${canGoForward ? "" : " disabled"}></button>
      </header>
      <div class="cal-week">${T.calWeek.map((w) => `<span>${esc(w)}</span>`).join("")}</div>
      <div class="cal-grid${c.loading ? " is-loading" : ""}">${cells.join("")}</div>
      <p class="cal-note">${esc(c.loading ? T.calLoading : T.calNote(engineInline()))}</p>
      <footer class="cal-foot">
        <button class="link" type="button" data-cal-act="tick-all"${data ? "" : " disabled"}>${esc(T.calTickAll)}</button>
        <button class="btn primary" type="button" data-cal-act="go"${n ? "" : " disabled"}>${esc(T.calGo(n))}</button>
      </footer>`;
  }

  // Clicks inside the calendar.
  function onCalClick(e) {
    const nav = e.target.closest("[data-month]");
    if (nav) return void loadCal(shiftMonth(state.cal.month, Number(nav.dataset.month)));
    const tick = e.target.closest("[data-tick]");
    if (tick) {
      const key = tick.dataset.tick;
      if (state.cal.ticked.has(key)) state.cal.ticked.delete(key);
      else state.cal.ticked.add(key);
      return void renderCal();
    }
    const open = e.target.closest("[data-open-day]");
    if (open) {
      closeCal();
      return void showDay(open.dataset.openDay);
    }
    const act = e.target.closest("[data-cal-act]");
    if (!act) return;
    if (act.dataset.calAct === "tick-all" && state.cal.data) {
      for (const d of state.cal.data.days) if (d.asks > 0 && !d.distilled && !d.future) state.cal.ticked.add(d.day);
      renderCal();
    } else if (act.dataset.calAct === "go" && state.cal.ticked.size) {
      const days = [...state.cal.ticked].sort();
      state.cal.ticked.clear();
      closeCal();
      distill(days);
    }
  }

  function lead(title, body) {
    el.stage.innerHTML = `<section class="card is-lead"><h2 class="card-title">${esc(title)}</h2>${body || ""}</section>`;
  }

  function renderStage() {
    const v = state.view;
    if (!v) {
      if (state.error) {
        lead(T.loadFail, `<p class="lead-error">${esc(state.error)}</p><div class="card-foot"><button class="btn primary" type="button" data-act="reload">${esc(T.reload)} <kbd>↵</kbd></button></div>`);
      } else {
        lead(T.loading, "");
      }
      return;
    }
    if (state.phase === "distilling") {
      const dots = ["note", "rule", "skill", "memory"].map((k) => `<i data-kind="${k}"></i>`).join("");
      if (state.batch) return lead(T.batching, `<p class="lead-text">${esc(T.batchText(state.batch.total))}</p><div class="settling">${dots}</div>`);
      return lead(T.distilling, `<p class="lead-text">${esc(T.distillingText(engineInline()))}</p><div class="settling">${dots}</div>`);
    }
    if (state.error) {
      return lead(T.distillFail, `<p class="lead-error">${esc(state.error)}</p><div class="card-foot"><button class="btn primary" type="button" data-act="distill">${esc(T.retry)} <kbd>↵</kbd></button></div>`);
    }
    if (state.tab === "settled") return renderSettled();
    if (state.tab === "today" && v.tasks && v.tasks.length) return renderOverview(v);
    if (v.candidates.length) return renderDeck(v);

    if (!v.stats.sessions) {
      return lead(
        T.nothingYet,
        `<p class="lead-text">${esc(T.pasteText(state.meta.captureHotkey ? keyLabel(state.meta.captureHotkey) : ""))}</p>
         <div class="card-foot"><button class="btn" type="button" data-act="paste">${esc(T.pasteBtn)} <kbd>⌘V</kbd></button></div>`
      );
    }
    if (!v.distilledAt) {
      return lead(
        T.roughTitle,
        `<p class="lead-text">${esc(T.notYetText(engineInline()))}</p>
         <div class="card-foot"><button class="btn primary" type="button" data-act="distill">${esc(T.distill)} <kbd>↵</kbd></button></div>`
      );
    }
    if (v.kept.length || v.skipped) {
      return lead(
        T.decidedTitle,
        `<p class="lead-text">${esc(T.decided(v.kept.length, v.skipped))}</p>
         <div class="card-foot"><button class="btn" type="button" data-act="library">${esc(T.openLib(T))} <kbd>L</kbd></button></div>`
      );
    }
    lead(T.nothingTitle, `<p class="lead-text">${esc(T.nothingText)}</p>`);
  }

  function renderDeck(v) {
    const list = v.candidates;
    const cur = focused();
    state.focusId = cur.id;
    const i = list.indexOf(cur);
    const peek = (c, side) =>
      c
        ? `<button class="peek is-${side}" type="button" data-go="${esc(c.id)}" data-kind="${esc(c.kind)}" aria-label="${esc(side === "prev" ? T.prev : T.next)}: ${esc(c.title)}">
             <i class="dot"></i><span class="peek-title">${phrased(c.title)}</span>
           </button>`
        : "";
    const pips =
      list.length > 1
        ? `<span class="pips">${list
            .map((c) => `<button type="button" class="pip${c.id === cur.id ? " is-on" : ""}" data-go="${esc(c.id)}" data-kind="${esc(c.kind)}" aria-label="${esc(c.title)}"></button>`)
            .join("")}</span>`
        : "";
    // Arrows either side: looking through the cards does not require deciding on any of them.
    const arrow = (c, side, step) => (c ? `<button class="nav is-${side}" type="button" data-step="${step}" aria-label="${esc(side === "prev" ? T.prev : T.next)}"></button>` : "");
    const from = cur.projects && cur.projects.length ? T.from(cur.projects) : "";
    // A card left over from an earlier day says so.
    const carried = cur.day && cur.day !== v.day ? T.leftFrom(cur.day, dayOffset(v.todayKey || v.day, -1)) : "";

    el.stage.innerHTML = `
      <div class="aura" data-kind="${esc(cur.kind)}"></div>
      ${peek(list[i - 1], "prev")}
      ${arrow(list[i - 1], "prev", -1)}
      ${arrow(list[i + 1], "next", 1)}
      <article class="card" data-kind="${esc(cur.kind)}" data-id="${esc(cur.id)}">
        <header class="card-head">
          <span class="kind"><i class="dot"></i>${esc(T.kinds[cur.kind] || cur.kind)}</span>
          ${carried ? `<span class="carried">${esc(carried)}</span>` : ""}
          <span class="from">${esc(from)}</span>
          ${pips}
        </header>
        <h2 class="card-title${cur.title.length > 26 ? " is-long" : ""}">${phrased(cur.title)}</h2>
        ${cur.payoff ? `<p class="payoff"><b>${esc(T.usefulWhen)}</b>${esc(cur.payoff)}</p>` : ""}
        <div class="md" tabindex="0">${renderMarkdown(cur.draft)}</div>
        <footer class="card-foot">
          <button class="btn primary" type="button" data-act="keep">${esc(T.keep)} <kbd>↵</kbd></button>
          <button class="btn" type="button" data-act="skip">${esc(T.skip)} <kbd>⌫</kbd></button>
          <button class="btn" type="button" data-act="copy">${esc(T.copy)} <kbd>C</kbd></button>
          <span class="dest" title="${esc(v.depositDir)}">${esc(T.savesTo(shortPath(v.depositDir)))}<button class="link" type="button" data-act="dest">${esc(T.change)}</button></span>
        </footer>
      </article>
      ${peek(list[i + 1], "next")}`;
    fitPhrases(el.stage.querySelector(".card-title"));
  }

  // A phrase wider than its line has wrapped inside itself, which strands
  // its last characters; let those phrases flow like ordinary text instead.
  function fitPhrases(title) {
    if (!title) return;
    const line = parseFloat(getComputedStyle(title).lineHeight) || 40;
    for (const ph of title.querySelectorAll(".ph")) {
      if (ph.offsetHeight > line * 1.5) ph.classList.add("is-flowing");
    }
  }

  function renderSettled() {
    const rows = settledRows();
    if (!rows.length) {
      return lead(T.noneToday, `<p class="lead-text">${esc(T.settledHint)}</p>`);
    }
    el.stage.innerHTML = `
      <section class="card is-list">
        <h2 class="card-title">${esc(T.doneToday(rows.length))}</h2>
        <ul class="rows">
          ${rows
            .map(
              (r) => `
            <li><button class="row" type="button" data-kind="${esc(r.kind)}"${r.path ? ` data-path="${esc(r.path)}"` : ""} title="${esc(T.openLib(T))}">
              <i class="dot"></i>
              <span class="row-title">${esc(r.title)}</span>
              <span class="row-where">${esc(r.where)}</span>
            </button></li>`
            )
            .join("")}
        </ul>
      </section>`;
  }

  // Which agents the work was read from, so it is plain what was looked at.
  function fromAgents(v) {
    return T.agents((v.stats && v.stats.agents) || []);
  }

  function renderStatus() {
    const v = state.view;
    if (state.toast) {
      el.status.className = "status is-toast";
      el.status.innerHTML =
        `<span>${esc(state.toast.text)}</span>` + (state.toast.undoId ? `<button class="link" type="button" data-act="undo">${esc(T.undo)}</button><kbd>Z</kbd>` : "");
      return;
    }
    el.status.className = "status";
    if (!v) {
      el.status.textContent = "";
      return;
    }
    if (state.switching) {
      el.status.textContent = T.switching;
      return;
    }
    if (state.phase === "distilling") {
      const secs = Math.max(0, Math.round((Date.now() - state.distillStart) / 1000));
      el.status.textContent = state.batch ? T.batchStatus(state.batch.done, state.batch.total, T.date(state.batch.day)) : T.distillingStatus(secs);
      return;
    }
    const parts = [];
    // The server behind the page is older than its files: what it answers may
    // not match what the page asks.
    if (state.meta && state.meta.stale) parts.push(`<span class="is-warn">${esc(T.stale)}</span><button class="link" type="button" data-act="restart">${esc(T.restartNow)}</button>`);
    if (state.tab === "open" && v.candidates.length > 1) parts.push(`<kbd>←</kbd><kbd>→</kbd><span>${esc(T.browse)}</span>`);
    if (v.distilledAt) {
      parts.push(`<span>${esc(T.statusDone(hhmm(v.distilledAt), v.stats.projects, v.stats.sessions, fromAgents(v), v.turnsSince))}</span>`);
      parts.push(`<button class="link" type="button" data-act="distill">${esc(T.distillAgain)}</button><kbd>R</kbd>`);
    } else if (v.stats.sessions) {
      parts.push(`<span>${esc(T.statusFresh(v.stats.projects, v.stats.sessions, fromAgents(v)))}</span>`);
    }
    // The way to the other day: yesterday's leftovers from today, and back.
    if (v.daysBack) parts.push(`<button class="link" type="button" data-act="otherDay">${esc(T.backToToday)}</button><kbd>Y</kbd>`);
    else if (v.earlier) parts.push(`<button class="link" type="button" data-act="otherDay">${esc(T.seeYesterday)}</button><kbd>Y</kbd>`);
    el.status.innerHTML = parts.join("");
  }

  // The first thing shown: the day as a stream (see drawStream), its title,
  // and one way on.
  let lastDrawn = "";

  function renderOverview(v) {
    const n = v.candidates.length;
    let title;
    let key;
    let foot;
    if (v.tasksAreRough) {
      title = v.distilledAt ? T.roughTitleDone(v.tasks.length) : T.overviewRough(v.tasks.length);
      key = esc(T.roughKey);
      foot = `<button class="btn primary" type="button" data-act="distill">${esc(v.distilledAt ? T.distillAgain : T.distill)} <kbd>↵</kbd></button>`;
    } else {
      const found = (v.dots || []).filter((d) => d.status !== "skipped").length;
      title = T.overviewTitle(v.tasks.length, found);
      key = T.dotsKey(`<i class="key-dot is-kept"></i>`, `<i class="key-dot is-open"></i>`, T, `<i class="key-dot is-ask"></i>`);
      foot = n
        ? `<button class="btn primary" type="button" data-act="deck">${esc(T.see(n, T))} <kbd>↵</kbd></button>`
        : `<button class="btn" type="button" data-act="library">${esc(T.openLib(T))} <kbd>L</kbd></button>`;
      // Work kept coming after the last pass: offer to pick up what is new.
      if (v.turnsSince) foot += ` <button class="btn" type="button" data-act="distill">${esc(T.refreshNew(v.turnsSince))} <kbd>R</kbd></button>`;
    }
    el.stage.innerHTML = `
      <section class="overview">
        <h2 class="overview-title">${esc(title)}</h2>
        <p class="overview-key">${key}</p>
        <div class="flow"></div>
        <div class="overview-foot">${foot}</div>
      </section>`;
    // The dots come in from the top when the page is shown or what is drawn
    // changes, not on every redraw.
    const drawn = `${v.day}|${v.tasks.length}|${(v.dots || []).map((d) => d.id + d.status).join()}`;
    const arriving = drawn !== lastDrawn;
    lastDrawn = drawn;
    drawStream(el.stage.querySelector(".flow"), v.tasks, v.activity, v.dots || [], arriving);
  }

  // Minutes into the work day for "HH:MM"; small hours belong to the day before.
  function minutesOf(hhmm) {
    const m = /^(\d{2}):(\d{2})$/.exec(hhmm || "");
    if (!m) return null;
    const v = Number(m[1]) * 60 + Number(m[2]);
    return v < 240 ? v + 1440 : v;
  }

  function hhmmOf(minutes) {
    const v = Math.round(minutes) % 1440;
    return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
  }

  // The day as a stream of specks running down the page, morning at the top:
  // one grey speck for each question asked, at its hour. Beside the point
  // where each thing began sit the dots it yielded,
  // one per thing worth keeping, in its kind's colour: solid once kept, a
  // ring while it waits, a faint speck if passed over.
  function drawStream(box, tasks, activity, dots, arriving) {
    const W = Math.max(300, box.clientWidth);
    const narrow = W < 760;
    const cx = narrow ? 30 : W / 2;
    const amp = narrow ? 4 : 30;
    const top = 22; // the stream runs from here to H - top; times sit in the gaps
    const pad = 46;
    const gap = narrow ? 112 : 72; // side by side, a card only has to clear the one two back
    let H = Math.round(Math.min(560, Math.max(340, window.innerHeight * 0.5)));

    // The span of the day: from the first sign of work to the last.
    const times = [];
    if (activity) times.push(minutesOf(activity.from), minutesOf(activity.to));
    for (const t of tasks) times.push(minutesOf(t.from), minutesOf(t.to));
    const known = times.filter((x) => x != null);
    const t0 = known.length ? Math.min(...known) : 9 * 60;
    const t1 = Math.max(t0 + 60, known.length ? Math.max(...known) : 18 * 60);

    // Each task where the stream had reached when it began; tasks without
    // hours spread evenly. A task never lands on top of the one before; the
    // stream grows longer instead. Dots nobody could place gather at the end.
    const placed = tasks.map((t, i) => ({ t, i, at: minutesOf(t.from), dots: dots.filter((d) => d.task === i) }));
    const timed = placed.some((p) => p.at != null);
    if (timed) placed.sort((p, q) => (p.at == null) - (q.at == null) || (p.at || 0) - (q.at || 0));
    const loose = dots.filter((d) => d.task < 0 || d.task >= tasks.length);
    if (loose.length) placed.push({ t: null, i: -1, at: null, dots: loose });
    let last = -Infinity;
    placed.forEach((p, n) => {
      const want = p.at != null ? pad + ((p.at - t0) / (t1 - t0)) * (H - 2 * pad) : p.t ? pad + (n + 0.5) * ((H - 2 * pad) / placed.length) : H - pad;
      p.y = Math.max(want, last + gap, pad);
      last = p.y;
    });
    if (last > H - 92) H = Math.round(last + 92); // room for the last one's words

    // Time to height, through the tasks' own positions, so each question's
    // speck lands beside the task it was asked during.
    const marks = [[pad, t0], ...placed.filter((p) => p.at != null).map((p) => [p.y, p.at]), [H - pad, t1]];
    const raw = activity && activity.bins.length ? activity.bins : null;
    const a0 = activity ? minutesOf(activity.from) : null;
    const xAt = (y) => cx + amp * Math.sin(y / 95 + 0.6);
    const f = (n) => n.toFixed(1);

    // The clusters first, so the specks can leave room around them.
    const R = narrow ? 8 : 11.5;
    const clusters = placed.map((p) => {
      const x = xAt(p.y);
      const shown = p.dots.slice(0, 8);
      const k = shown.length;
      const ring = k <= 1 ? 0 : R * (0.42 + 0.14 * k);
      const parts = shown.map((d, j) => {
        const a = (k === 2 ? 0 : -Math.PI / 2) + (j / Math.max(1, k)) * Math.PI * 2;
        const dx = x + ring * Math.cos(a);
        const dy = p.y + ring * Math.sin(a);
        const tip = `<title>${esc(d.title)}</title>`;
        const r = d.status === "skipped" ? R * 0.42 : R;
        return `<circle class="dot is-${d.status}" data-kind="${esc(d.kind)}" data-act="dot" data-id="${esc(d.id)}" cx="${f(dx)}" cy="${f(dy)}" r="${f(r)}">${tip}</circle>`;
      });
      // A thing that left nothing to keep still marks its place.
      if (!k) parts.push(`<circle class="mark" cx="${f(x)}" cy="${f(p.y)}" r="${narrow ? 3.5 : 4.5}"/>`);
      const reach = (k ? ring + R : 5) + 6;
      return { p, x, reach, html: parts.join("") };
    });

    // Every question asked is a small grey speck at its hour, scattered a
    // little to either side and never on top of another: thick and wide
    // where the asking was, a thin trail in the quiet hours.
    const yAt = (t) => {
      if (t <= marks[0][1]) return marks[0][0];
      for (let k = 1; k < marks.length; k++) {
        const [ya, ta] = marks[k - 1];
        const [yb, tb] = marks[k];
        if (t <= tb) return tb > ta ? ya + ((t - ta) / (tb - ta)) * (yb - ya) : yb;
      }
      return marks[marks.length - 1][0];
    };
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // the same day scatters the same way
    // Each half hour gets the stretch of stream its hour maps to, and spreads
    // sideways as far as it needs for every question to have its own speck.
    const spans = (raw || []).map((count, k) => {
      const ya = Math.max(top + 6, yAt(a0 + k * 30));
      const yb = Math.min(H - top - 6, yAt(a0 + (k + 1) * 30));
      const tall = Math.max(8, yb - ya);
      const half = Math.min(narrow ? 34 : 96, Math.max(narrow ? 5 : 8, (count * (narrow ? 34 : 44)) / (2 * tall)));
      return { count, ya, yb: ya + tall, half };
    });
    const specks = [];
    const taken = clusters.map((c) => [c.x, c.p.y, c.reach + 4]);
    spans.forEach((sp) => {
      const html = [];
      for (let n = 0; n < sp.count; n++) {
        const r = 1.4 + rnd() * 1.5;
        for (let tries = 0; tries < 24; tries++) {
          const y = sp.ya + rnd() * (sp.yb - sp.ya);
          const side = rnd() * 2 - 1;
          const x = xAt(y) + Math.sign(side) * Math.pow(Math.abs(side), 0.85) * (sp.half + tries * 1.5);
          if (taken.some(([tx, ty, tr]) => Math.hypot(x - tx, y - ty) < r + tr + 1.4)) continue;
          taken.push([x, y, r]);
          html.push(`<circle class="s${Math.floor(rnd() * 3)}" cx="${f(x)}" cy="${f(y)}" r="${f(r)}"/>`);
          break;
        }
      }
      if (html.length) specks.push({ y: (sp.ya + sp.yb) / 2, html: html.join("") });
    });

    const cards = [];
    const ties = [];
    clusters.forEach((c, n) => {
      const { p } = c;
      const side = narrow || n % 2 === 0 ? "right" : "left";
      // Clear of the specks along the whole height of the words, not just
      // the first line, going by where they actually landed.
      let widest = 0;
      for (const [x, y, r] of taken.slice(clusters.length)) {
        if (y > p.y - 18 && y < p.y + 86 && (side === "right") === x > xAt(y)) widest = Math.max(widest, Math.abs(x - xAt(y)) + r);
      }
      const room = Math.max(c.reach + 14, widest + 12);
      const end = side === "right" ? c.x + room : c.x - room;
      ties.push(`<line class="tie" x1="${f(side === "right" ? c.x + c.reach : c.x - c.reach)}" y1="${f(p.y)}" x2="${f(end)}" y2="${f(p.y)}"/>`);
      let html;
      if (!p.t) {
        html = `<div class="flow-item is-${side}"><p class="flow-line is-count"><span>${esc(T.dotsLoose(p.dots.length))}</span></p></div>`;
      } else {
        const t = p.t;
        const when = t.from ? (t.to && t.to !== t.from ? `${t.from}–${t.to}` : t.from) : "";
        const where = [t.project, T.asks(t.asks || 0)].filter(Boolean).join(T.lang === "zh" ? "，" : ", ");
        const body = t.share
          ? `<p class="flow-line"><b class="who is-you">${esc(T.you)}</b><span>${esc(t.human)}</span></p>
             <p class="flow-line"><b class="who is-ai">${esc(T.ai)}</b><span>${esc(t.ai)}</span></p>` +
            (t.doubt ? `<p class="flow-line"><b class="who is-doubt">${esc(T.doubt)}</b><span>${esc(t.doubt)}</span></p>` : "")
          : `<p class="flow-line is-count"><span>${esc(where)}</span></p>`;
        html = `<div class="flow-item is-${side}">${when ? `<p class="flow-time">${esc(when)}</p>` : ""}<p class="flow-title">${esc(t.title)}</p>${body}</div>`;
      }
      cards.push({ side, x: end, y: p.y, html });
    });

    box.classList.toggle("is-arriving", Boolean(arriving));
    box.style.height = `${H}px`;
    box.innerHTML = `
      <svg class="stream" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
        <g class="specks" aria-hidden="true">${specks.map((g) => `<g class="ht-row">${g.html}</g>`).join("")}</g>
        <text class="ends" x="${f(xAt(top))}" y="12" aria-hidden="true">${esc(hhmmOf(t0))}</text>
        <text class="ends" x="${f(xAt(H - top))}" y="${H - 4}" aria-hidden="true">${esc(hhmmOf(t1))}</text>
        <g aria-hidden="true">${ties.join("")}</g>
        ${clusters.map((c) => `<g class="cluster">${c.html}</g>`).join("")}
      </svg>
      ${cards.map((c) => c.html).join("")}`;
    // Placed and timed through the CSSOM: the page's CSP forbids inline styles.
    // As the page arrives the dots come in from the top, as the day did.
    const delay = (y) => `${((y / H) * 1.1).toFixed(2)}s`;
    box.querySelectorAll(".ht-row").forEach((g, n) => (g.style.animationDelay = delay(specks[n].y)));
    box.querySelectorAll(".cluster").forEach((g, n) => (g.style.animationDelay = delay(clusters[n].p.y + 30)));
    box.querySelectorAll(".flow-item").forEach((node, n) => {
      const c = cards[n];
      node.style.top = `${c.y - 12}px`;
      node.style.animationDelay = delay(c.y + 40);
      if (c.side === "right") node.style.left = `${c.x + 8}px`;
      else node.style.right = `${W - c.x + 8}px`;
      const room = c.side === "right" ? W - c.x - 8 : c.x - 8;
      node.style.setProperty("--w", `${Math.max(140, Math.min(330, room - 12))}px`);
    });
  }

  // ------------------------------------------------------------- actions

  function setView(v) {
    state.view = v;
    if (!v.candidates.some((c) => c.id === state.focusId)) state.focusId = v.candidates[0] ? v.candidates[0].id : null;
  }

  let refreshing = null;

  // One scan at a time; a second request while one is running shares it.
  function refresh() {
    if (!refreshing) refreshing = load().finally(() => (refreshing = null));
    return refreshing;
  }

  async function load() {
    if (!state.view) state.error = null;
    try {
      const [meta, v, running] = await Promise.all([api.meta(), api.today(state.pick || "auto"), api.distilling()]);
      state.meta = meta;
      // An explicit language wins; "auto" leaves it to the browser's own.
      const lang = params.get("lang") || window.DotjarWords.language(meta.language) || navigator.language;
      T = window.DotjarWords.copy(lang, params.get("words") || meta.wording, v.daysBack, v.day);
      setView(v);
      if (running && state.phase !== "distilling") watchDistill(running.total > 1 ? running : null);
      else if (state.phase === "loading") state.phase = "ready";
    } catch (err) {
      state.phase = "ready";
      state.error = errorText(err);
    }
    render();
  }

  // A dot on the stream opens what it stands for: the card if it still
  // waits, its page in the library if it was kept.
  function openDot(id) {
    const d = ((state.view && state.view.dots) || []).find((x) => x.id === id);
    if (!d) return;
    if (d.status === "kept" && d.file) return void actions.library(window.DotjarMarkdown.anchorFor(d.file));
    if (d.status === "open") {
      state.focusId = id;
      return void actions.deck();
    }
  }

  // Ask the server to make way for a fresh copy of itself, wait for it to
  // answer on the same address, then load the page again from it.
  async function restartServer() {
    if (!api.restart || state.restarting) return;
    state.restarting = true;
    state.toast = { text: T.restarting };
    render();
    try {
      await api.restart();
    } catch (err) {
      state.restarting = false;
      toast(errorText(err));
      return;
    }
    for (let waited = 0; waited < 20000; waited += 500) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const meta = await api.meta();
        if (!meta.stale) return location.reload();
      } catch {
        // not back yet
      }
    }
    state.restarting = false;
    toast(T.restartFail);
  }

  function go(delta) {
    const list = candidates();
    if (state.tab !== "open" || list.length < 2 || state.busy) return;
    const i = Math.max(0, list.findIndex((c) => c.id === state.focusId));
    const next = Math.min(list.length - 1, Math.max(0, i + delta));
    if (next === i) return;
    const from = measureDeck();
    state.focusId = list[next].id;
    renderStage();
    if (!reducedMotion()) glideDeck(from, delta);
  }

  function measureDeck() {
    const rect = (selector) => {
      const node = el.stage.querySelector(selector);
      return node ? node.getBoundingClientRect() : null;
    };
    return { card: rect(".card"), prev: rect(".peek.is-prev"), next: rect(".peek.is-next") };
  }

  // Turning a card moves the whole row at once, one motion and no copies:
  // the card that was peeking glides to the middle and grows into the card,
  // the card that was open shrinks back into a peek on the other side, a new
  // peek slides in from beyond the edge. While they move they are bare glass;
  // the words fill in once each has landed, so nothing is seen stretched.
  function glideDeck(from, delta) {
    const ms = 420;
    const easing = "cubic-bezier(0.22, 0.8, 0.24, 1)";
    const fillIn = (node, delay) => {
      for (const part of node.children) part.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay, easing: "ease-out", fill: "backwards" });
    };
    // From one box to another: where it was, as big as it was.
    const travel = (r0, r1) => ({
      dx: r0.left + r0.width / 2 - (r1.left + r1.width / 2),
      dy: r0.top + r0.height / 2 - (r1.top + r1.height / 2),
      sx: r0.width / r1.width,
      sy: r0.height / r1.height,
    });
    const card = el.stage.querySelector(".card");
    const source = delta > 0 ? from.next : delta < 0 ? from.prev : null;
    if (card && !source) {
      // Put back, or no peek to come from: it settles in where it is.
      card.animate([{ opacity: 0, transform: "scale(0.97)" }, { opacity: 1, transform: "none" }], { duration: 300, easing });
    }
    if (card && source) {
      const m = travel(source, card.getBoundingClientRect());
      card.animate([{ transform: `translate(${m.dx}px, ${m.dy}px) scale(${m.sx}, ${m.sy})`, opacity: 0.42 }, { transform: "none", opacity: 1 }], { duration: ms, easing });
      fillIn(card, 200);
    }
    if (!delta) return;
    // Peeks keep their own resting transform (centred scale); the move is added on top.
    const PEEK_SCALE = 0.94;
    const move = (node, m, opacity) => {
      node.animate(
        [{ transform: `translate(${m.dx / PEEK_SCALE}px, ${m.dy / PEEK_SCALE}px) scale(${m.sx}, ${m.sy})` }, { transform: "translate(0, 0) scale(1, 1)" }],
        { duration: ms, easing, composite: "add" }
      );
      node.animate([{ opacity }, { opacity: 0.42 }], { duration: ms, easing });
    };
    const behind = el.stage.querySelector(delta > 0 ? ".peek.is-prev" : ".peek.is-next");
    if (behind && from.card) {
      move(behind, travel(from.card, behind.getBoundingClientRect()), 0.9);
      fillIn(behind, 260);
    }
    const ahead = el.stage.querySelector(delta > 0 ? ".peek.is-next" : ".peek.is-prev");
    if (ahead) move(ahead, { dx: delta > 0 ? 90 : -90, dy: 0, sx: 1, sy: 1 }, 0);
  }

  function setTab(tab) {
    if (state.tab === tab || !state.view) return;
    state.tab = tab;
    renderBar();
    renderStage();
    renderStatus();
  }

  // The kept card becomes a dot and flies up into the count of what is kept.
  async function dropDot(kind) {
    const from = el.stage.querySelector(".card .kind .dot");
    const to = el.tabs.querySelector('.tab[data-tab="settled"] b');
    if (!from || !to || reducedMotion()) return;
    const a = from.getBoundingClientRect();
    const c = to.getBoundingClientRect();
    const dot = document.createElement("i");
    dot.className = "fly";
    dot.dataset.kind = kind;
    document.body.appendChild(dot);
    const anim = dot.animate(
      [
        { transform: `translate(${a.left}px, ${a.top}px) scale(1.2)`, opacity: 1 },
        { transform: `translate(${c.left + c.width / 2 - 5}px, ${c.top + c.height / 2 - 5}px) scale(0.6)`, opacity: 0.2 },
      ],
      { duration: 520, easing: "cubic-bezier(0.3, 0, 0.2, 1)", fill: "forwards" }
    );
    // A hidden window produces no frames; never let the keep wait on one.
    await Promise.race([anim.finished.catch(() => {}), sleep(640)]);
    dot.remove();
  }

  async function decide(verb) {
    const cur = focused();
    if (!cur || state.busy || state.tab !== "open") return;
    state.busy = true;
    const card = el.stage.querySelector(".card");
    const list = candidates();
    const i = list.indexOf(cur);
    const next = list[i + 1] || list[i - 1] || null;
    try {
      if (card) card.classList.add(verb === "keep" ? "is-kept" : "is-skipped");
      const [v] = await Promise.all([verb === "keep" ? api.keep(cur.id) : api.skip(cur.id), verb === "keep" ? dropDot(cur.kind) : pause(220)]);
      const from = measureDeck();
      state.focusId = next ? next.id : null;
      if (verb === "keep") state.bump = true;
      setView(v);
      render();
      // The next card glides in from where it was peeking; the decided one is gone.
      if (!reducedMotion() && state.tab === "open") glideDeck({ ...from, card: null }, list[i + 1] ? 1 : -1);
      if (verb === "keep") {
        const kept = v.kept.find((k) => k.id === cur.id);
        toast(T.keptTo(shortPath((kept && kept.fileLabel) || v.depositDir, 60)), cur.id);
      } else {
        toast(T.skipped, cur.id);
      }
    } catch (err) {
      render();
      toast(errorText(err));
    } finally {
      state.busy = false;
    }
  }

  async function undo() {
    if (!state.toast || !state.toast.undoId || state.busy) return;
    const id = state.toast.undoId;
    state.toast = null;
    try {
      const v = await api.reopen(id);
      state.focusId = id;
      state.tab = "open";
      setView(v);
      render();
      if (!reducedMotion()) glideDeck({}, 0);
      toast(T.putBack);
    } catch (err) {
      toast(errorText(err));
    }
  }

  async function copyDraft() {
    const cur = focused();
    if (!cur || state.tab !== "open") return;
    await api.copy(`# ${cur.title}\n\n${cur.draft}\n`);
    toast(T.copied);
  }

  function watchDistill(batch) {
    state.phase = "distilling";
    state.error = null;
    if (batch) state.batch = batch;
    if (!state.distillStart) state.distillStart = Date.now();
    clearInterval(ticker);
    ticker = setInterval(async () => {
      if (state.batch) {
        try {
          const p = await api.distilling();
          if (p && p.total) state.batch = p;
        } catch {
          // keep the last known progress
        }
      }
      renderStatus();
    }, 1000);
  }

  // Go through the day on screen, or, given days, each of them in turn.
  async function distill(days) {
    if (state.phase === "distilling" || !state.view) return;
    const many = Array.isArray(days) && days.length ? days : null;
    state.distillStart = Date.now();
    state.tab = "today";
    watchDistill(many ? { done: 0, total: many.length, day: many[0] } : null);
    render();
    try {
      const res = await api.distill(many || undefined);
      setView(res.view);
      state.phase = "ready";
      render();
      if (many) toast(T.batchDone(res.days || many.length, res.found || 0) + (res.failed && res.failed.length ? T.batchFailed(res.failed.length) : ""));
      else if (res.again) toast(T.distillMore(res.found));
      else toast(res.found ? T.distillDone(res.found) : T.distillNone);
    } catch (err) {
      state.phase = "ready";
      state.error = errorText(err);
      render();
    } finally {
      clearInterval(ticker);
      state.distillStart = 0;
      state.batch = null;
    }
  }

  async function paste() {
    try {
      setView(await api.paste());
      render();
      toast(T.captured);
    } catch (err) {
      toast(errorText(err));
    }
  }

  async function chooseDest() {
    try {
      setView(await api.chooseDepositDir(state.view ? state.view.depositDir : ""));
      render();
    } catch (err) {
      toast(errorText(err));
    }
  }

  async function openLibrary(anchor) {
    try {
      await api.library(typeof anchor === "string" ? anchor : undefined);
    } catch (err) {
      toast(errorText(err));
    }
  }

  function usableEngines() {
    return (state.meta.engines || []).filter((e) => e.available);
  }

  // Hand the going-through to the next engine this machine has.
  async function switchEngine() {
    const choices = usableEngines();
    if (choices.length < 2 || state.phase === "distilling") return;
    const next = choices[(choices.findIndex((e) => e.id === state.meta.engine) + 1) % choices.length];
    try {
      state.meta = { ...state.meta, ...(await api.setEngine(next.id)) };
      render();
      toast(T.engineSwitched(T.engineShort(state.meta.engine, state.meta.engineModel)));
    } catch (err) {
      toast(errorText(err));
    }
  }

  // Switch between today and yesterday.
  function otherDay() {
    const v = state.view;
    if (!v || state.phase === "distilling") return;
    if (!v.daysBack && !v.earlier) return;
    showDay(v.daysBack ? v.todayKey : dayOffset(v.todayKey, -1));
  }

  // Look at another day. Picking today goes back to following the calendar.
  async function showDay(key) {
    const v = state.view;
    if (!v || state.phase === "distilling" || key === v.day) return;
    state.pick = key === v.todayKey ? undefined : key;
    state.focusId = null;
    state.tab = "today";
    state.switching = true;
    renderStatus();
    await refresh();
    state.switching = false;
    renderStatus();
  }

  const actions = {
    keep: () => decide("keep"),
    skip: () => decide("skip"),
    copy: copyDraft,
    undo,
    distill: () => distill(),
    paste,
    dest: chooseDest,
    library: openLibrary,
    deck: () => setTab("open"),
    otherDay,
    engine: switchEngine,
    reload: () => refresh(),
    restart: () => restartServer(),
  };

  // -------------------------------------------------------------- events

  document.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (act && act.dataset.act === "dot") return void openDot(act.dataset.id);
    if (act) return void actions[act.dataset.act]();
    const tab = e.target.closest("[data-tab]");
    if (tab) return void setTab(tab.dataset.tab);
    const step = e.target.closest("[data-step]");
    if (step) return void go(Number(step.dataset.step));
    const peek = e.target.closest("[data-go]");
    if (peek) {
      const list = candidates();
      const to = list.findIndex((c) => c.id === peek.dataset.go);
      const from = list.findIndex((c) => c.id === state.focusId);
      if (to !== -1) go(to - from);
      return;
    }
    // An entry opens in the library, scrolled to and unfolded.
    const row = e.target.closest(".row[data-path]");
    if (row) openLibrary(window.DotjarMarkdown.anchorFor(row.dataset.path));
  });

  el.close.addEventListener("click", () => api.hide());
  el.library.addEventListener("click", openLibrary);
  el.date.addEventListener("click", (e) => {
    e.stopPropagation();
    if (state.cal.open) closeCal();
    else openCal();
  });
  el.cal.addEventListener("click", (e) => {
    e.stopPropagation();
    onCalClick(e);
  });
  // A click anywhere else puts the calendar away.
  document.addEventListener("click", () => closeCal());
  el.engine.addEventListener("click", switchEngine);

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
      e.preventDefault();
      paste();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (state.cal.open) {
      if (e.key === "Escape") closeCal();
      return; // while the calendar is open, it has the keyboard
    }
    // A focused button handles its own Enter and Space.
    const onButton = document.activeElement && document.activeElement.tagName === "BUTTON";
    const deciding = state.tab === "open" && candidates().length > 0 && state.phase !== "distilling" && !state.error;
    switch (e.key) {
      case "Escape":
        // Out of the cards or the list first; from the day itself, put the veil away.
        if (state.tab !== "today") setTab("today");
        else api.hide();
        break;
      case "ArrowRight":
      case "j":
        go(1);
        e.preventDefault();
        break;
      case "ArrowLeft":
      case "k":
        go(-1);
        e.preventDefault();
        break;
      case "Enter":
        if (onButton) return;
        if (deciding) decide("keep");
        else {
          const primary = el.stage.querySelector(".btn.primary[data-act]");
          if (primary) actions[primary.dataset.act]();
        }
        break;
      case "Backspace":
      case "Delete":
      case "x":
        if (deciding) decide("skip");
        break;
      case "c":
        if (deciding) copyDraft();
        break;
      case "r":
        if (state.view && state.view.stats.sessions) distill();
        break;
      case "z":
        undo();
        break;
      case "l":
        openLibrary();
        break;
      case "y":
        otherDay();
        break;
      case "e":
        switchEngine();
        break;
      case "1":
        setTab("today");
        break;
      case "2":
        setTab("open");
        break;
      case "3":
        setTab("settled");
        break;
      default:
        return;
    }
  });

  // Sideways on a trackpad, or a swipe on a touch screen, turns the card. The
  // card follows the fingers a little and turns after a short pull; the
  // coasting that follows is ignored, but a fresh flick is not.
  const swipe = { travelled: 0, turned: false, idle: null, last: 0 };
  const settleCard = () => {
    const card = el.stage.querySelector(".card");
    if (card) {
      card.style.transition = "transform 0.28s cubic-bezier(0.2, 0.9, 0.3, 1)";
      card.style.transform = "";
    }
  };
  el.stage.addEventListener(
    "wheel",
    (e) => {
      if (state.tab !== "open" || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      const size = Math.abs(e.deltaX);
      // A new flick: the coasting had died down, or the push turned around.
      if (swipe.turned && ((size > 4 && size > swipe.last * 1.8) || Math.sign(e.deltaX) !== Math.sign(swipe.travelled))) {
        swipe.turned = false;
        swipe.travelled = 0;
      }
      swipe.last = size;
      clearTimeout(swipe.idle);
      swipe.idle = setTimeout(() => {
        if (!swipe.turned) settleCard();
        swipe.travelled = 0;
        swipe.turned = false;
        swipe.last = 0;
      }, 90);
      if (swipe.turned) return;
      swipe.travelled += e.deltaX;
      const card = el.stage.querySelector(".card");
      if (card && !reducedMotion()) {
        card.style.transition = "none";
        card.style.transform = `translateX(${(-Math.sign(swipe.travelled) * Math.min(60, Math.abs(swipe.travelled) * 0.5)).toFixed(1)}px)`;
      }
      if (Math.abs(swipe.travelled) > 34) {
        swipe.turned = true;
        go(swipe.travelled > 0 ? 1 : -1);
        settleCard();
      }
    },
    { passive: false }
  );
  let touchAt = null;
  el.stage.addEventListener("touchstart", (e) => (touchAt = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null), { passive: true });
  el.stage.addEventListener(
    "touchend",
    (e) => {
      if (!touchAt || state.tab !== "open") return;
      const dx = e.changedTouches[0].clientX - touchAt.x;
      const dy = e.changedTouches[0].clientY - touchAt.y;
      touchAt = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    },
    { passive: true }
  );

  // When the page was last looked at; after a long absence it starts on today again.
  let lastSeen = Date.now();
  let enteringTimer = null;

  // Each time the veil is lowered: replay the entrance and look again.
  function entered() {
    if (Date.now() - lastSeen > 30 * 60 * 1000) state.pick = undefined;
    lastSeen = Date.now();
    document.body.classList.remove("is-entering");
    void document.body.offsetWidth;
    document.body.classList.add("is-entering");
    // Only for the entrance: left on, every card rendered later would play it again.
    clearTimeout(enteringTimer);
    enteringTimer = setTimeout(() => document.body.classList.remove("is-entering"), 1200);
    lastDrawn = ""; // the dots come in again
    refresh();
  }

  if (api.onShown) api.onShown(entered);
  if (api.onCaptured) api.onCaptured(refresh);
  window.addEventListener("resize", () => {
    if (state.tab === "today") renderStage(); // the stream is drawn to the window's size
    else fitPhrases(el.stage.querySelector(".card-title"));
  });

  render();
  if (host && !inBrowser) refresh(); // the desktop app announces each showing itself
  else entered();
})();
