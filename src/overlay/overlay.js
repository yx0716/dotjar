"use strict";

(function () {
  const { render: renderMarkdown, escapeHtml: esc } = window.DotjarMarkdown;

  // `window.dotjarBridge` comes from the desktop shell's preload script, or
  // from web-bridge.js when the page is served by `dotjar web`. In demo mode,
  // or opened as a plain file, a made-up day stands in for it.
  const host = window.dotjarBridge;
  const api = host && !host.demo ? host : window.DotjarDemo.createBridge(host);
  const inBrowser = Boolean(host && host.web);
  // The page is its own surface, sky and all, whenever it is not laid over a
  // desktop: served to a browser, or opened as a plain file.
  const ownSurface = inBrowser || !host;
  if (host && host.demo) document.body.classList.add("demo");
  if (ownSurface) document.body.classList.add("web");

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
    rest: $("rest"),
    restBtn: $("rest-btn"),
    restPop: $("rest-pop"),
  };

  // A four-pointed star about the origin, one unit from centre to tip.
  const STAR = "M0,-1 C0.07,-0.28 0.28,-0.07 1,0 C0.28,0.07 0.07,0.28 0,1 C-0.07,0.28 -0.28,0.07 -1,0 C-0.28,-0.07 -0.07,-0.28 0,-1 Z";
  // The jar that kept stars go into, a net for going through the day, and a
  // moon for the rests.
  const JAR = `<svg class="ico" viewBox="0 0 20 22" aria-hidden="true"><rect x="5.2" y="1" width="9.6" height="3.2" rx="1.2"/><path d="M4.4 6.2h11.2c1.6 1 2.4 2.4 2.4 4.2v6.6a3.2 3.2 0 0 1-3.2 3.2H5.2A3.2 3.2 0 0 1 2 17v-6.6c0-1.8.8-3.2 2.4-4.2z"/><path class="in s1" d="M6.9 11.6l.55 1.45 1.45.55-1.45.55L6.9 15.6l-.55-1.45-1.45-.55 1.45-.55z"/><path class="in s2" d="M12.6 9l.45 1.15 1.15.45-1.15.45L12.6 12.2l-.45-1.15L11 10.6l1.15-.45z"/><path class="in s3" d="M11.4 14.4l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z"/></svg>`;
  const NET = `<svg class="ico" viewBox="0 0 18 18" aria-hidden="true"><circle cx="7.4" cy="7.4" r="5.6"/><path d="M11.5 11.5l5 5M2.6 5.4h9.6M2.6 9.4h9.6M5.4 2.4v10M9.4 2.4v10"/></svg>`;
  const MOON = `<svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M16 12.4A7 7 0 0 1 7.6 4 7 7 0 1 0 16 12.4z"/></svg>`;

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
      ...v.kept.map((k) => ({ kind: k.kind, title: k.title, where: T.mine, path: k.file, by: "you" })),
      ...v.settled.map((s) => ({
        by: "agent",
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
    // The jar, with how many stars it holds by now.
    const jar = (v && v.jar) || { total: 0, week: 0 };
    el.library.innerHTML = `${JAR}<span class="lbl">${esc(T.library)}</span>${jar.total ? `<b>${jar.total}</b>` : ""} <kbd>L</kbd>`;
    el.library.title = jar.total ? [T.jarTotal(jar.total), jar.week ? T.jarWeek(jar.week) : ""].filter(Boolean).join(T.lang === "zh" ? "，" : ", ") : T.openLib(T);
    if (state.bumpJar) el.library.querySelector("b") && el.library.querySelector("b").classList.add("is-bumped");
    state.bumpJar = false;
    renderRestButton();
    // Offered only when there is a choice: more than one engine on this machine.
    const choices = usableEngines();
    el.engine.hidden = choices.length < 2;
    if (choices.length > 1) {
      const next = choices[(choices.findIndex((e) => e.id === state.meta.engine) + 1) % choices.length];
      el.engine.innerHTML = `${esc(T.engineBtn(T.engineShort(state.meta.engine, state.meta.engineModel)))} <kbd>E</kbd>`;
      el.engine.title = T.engineHint(T.engineShort(next.id, next.model));
    }
    el.close.innerHTML = `${esc(T.close)} <kbd>esc</kbd>`;
    el.close.hidden = ownSurface; // a tab is put away like any other tab
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
      if (state.batch) return lead(T.batching, `<p class="lead-text">${esc(T.batchText(state.batch.total))}</p>${fishing()}`);
      return lead(T.distilling, `<p class="lead-text">${esc(T.distillingText(engineInline()))}</p>${fishing()}`);
    }
    if (state.error) {
      return lead(T.distillFail, `<p class="lead-error">${esc(state.error)}</p><div class="card-foot"><button class="btn primary" type="button" data-act="distill">${esc(T.retry)} <kbd>↵</kbd></button></div>`);
    }
    if (state.tab === "settled") return renderSettled();
    if (state.tab === "today" && v.tasks && v.tasks.length) return renderOverview(v);
    if (v.candidates.length) return renderDeck(v);

    if (!v.stats.sessions) {
      // Nothing of their own to look at yet: the made-up day shows what a
      // full one is like.
      const demo = inBrowser ? `<a class="btn" href="/?demo">${esc(T.demoLink)}</a>` : "";
      return lead(
        T.nothingYet,
        `<p class="lead-text">${esc(T.pasteText(state.meta.captureHotkey ? keyLabel(state.meta.captureHotkey) : ""))}</p>
         <div class="card-foot"><button class="btn" type="button" data-act="paste">${esc(T.pasteBtn)} <kbd>⌘V</kbd></button>${demo}</div>`
      );
    }
    if (!v.distilledAt) {
      return lead(
        T.roughTitle,
        `<p class="lead-text">${esc(T.notYetText(engineInline()))}</p>
         <div class="card-foot"><button class="btn primary" type="button" data-act="distill">${NET}${esc(T.distill)} <kbd>↵</kbd></button></div>`
      );
    }
    if (v.kept.length || v.skipped) {
      // Everything decided: what the jar holds now, and the one thing to try next.
      const jar = v.jar && v.jar.total ? [T.jarTotal(v.jar.total), v.jar.week ? T.jarWeek(v.jar.week) : ""].filter(Boolean).join(T.lang === "zh" ? "，" : ", ") + (T.lang === "zh" ? "。" : ".") : "";
      const next = v.growth && v.growth.next ? `<p class="lead-text">${esc(T.growthNext)}${T.lang === "zh" ? "：" : ": "}${esc(v.growth.next)}</p>` : "";
      return lead(
        T.decidedTitle,
        `<p class="lead-text">${esc(T.decided(v.kept.length, v.skipped))}${jar ? ` ${esc(jar)}` : ""}</p>${next}
         <div class="card-foot"><button class="btn" type="button" data-act="library">${JAR}${esc(T.openLib(T))} <kbd>L</kbd></button></div>`
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
          <span class="kind" title="${esc((T.kindHints && T.kindHints[cur.kind]) || "")}"><i class="dot"></i>${esc(T.kinds[cur.kind] || cur.kind)}</span>
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
            <li><button class="row${r.by === "agent" ? " by-agent" : ""}" type="button" data-kind="${esc(r.kind)}"${r.path ? ` data-path="${esc(r.path)}"` : ""} title="${esc(T.openLib(T))}">
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
    if (!host && /^https?:$/.test(location.protocol)) parts.push(`<span>${esc(T.demoNote)}</span><a class="link" href="/">${esc(T.backToToday)}</a>`);
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

  // While the model reads: a net going back and forth through a stretch of
  // the river, and a star of each kind coming up out of it in turn.
  function fishing() {
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const dust = Array.from({ length: 28 }, () => `<circle cx="${(6 + rnd() * 308).toFixed(1)}" cy="${(40 + rnd() * 32).toFixed(1)}" r="${(0.6 + rnd() * 1.1).toFixed(1)}" opacity="${(0.25 + rnd() * 0.6).toFixed(2)}"/>`).join("");
    const stars = ["craft", "strategy", "lesson", "trap"]
      .map((k, i) => `<g class="f-star" data-kind="${k}"><path d="${STAR}" transform="translate(${62 + i * 66} ${46 - (i % 2) * 7}) scale(8)"/></g>`)
      .join("");
    return `<div class="fishing" aria-hidden="true"><svg viewBox="0 0 320 84">
      <g class="f-dust">${dust}</g>
      <g class="f-catch">${stars}</g>
      <g class="f-net"><path class="f-pole" d="M0 -48V-6"/><ellipse class="f-hoop" rx="17" ry="6"/><path class="f-mesh" d="M-17 0Q-13 19 0 21Q13 19 17 0M-9 5Q-6 16 0 21M9 5Q6 16 0 21M0 6V21M-15 9H15"/></g>
    </svg></div>`;
  }

  // The first thing shown: the day as a river of stars (see drawGalaxy), its
  // title, what it says about how the person is getting on, and one way on.
  let lastDrawn = "";

  function renderOverview(v) {
    const n = v.candidates.length;
    let title;
    let key;
    let foot;
    if (v.tasksAreRough) {
      // Every conversation of the day, though only the busiest are drawn.
      title = v.distilledAt ? T.roughTitleDone(v.stats.projects || v.tasks.length) : T.overviewRough(v.stats.sessions || v.tasks.length);
      key = `<span>${esc(T.roughKey)}</span>`;
      foot = `<button class="btn primary" type="button" data-act="distill">${NET}${esc(v.distilledAt ? T.distillAgain : T.distill)} <kbd>↵</kbd></button>`;
    } else {
      const found = (v.dots || []).filter((d) => d.status !== "skipped").length;
      title = T.overviewTitle(v.tasks.length, found);
      // What the marks on the river are, then the four kinds of star.
      key =
        T.dotsKey(`<i class="key-star"></i>`, `<svg class="key-open" viewBox="-1.3 -1.3 2.6 2.6" aria-hidden="true"><path d="${STAR}"/></svg>`, T, `<i class="key-ask"></i>`) +
        `<i class="sep"></i>` +
        ["craft", "strategy", "lesson", "trap"].map((k) => `<span data-kind="${k}" title="${esc(T.kindHints[k])}"><i class="key-star"></i>${esc(T.kinds[k])}</span>`).join("");
      foot = n
        ? `<button class="btn primary" type="button" data-act="deck">${esc(T.seeOpen(n))} <kbd>↵</kbd></button>`
        : `<button class="btn" type="button" data-act="library">${JAR}${esc(T.openLib(T))} <kbd>L</kbd></button>`;
      // Work kept coming after the last pass: offer to pick up what is new.
      if (v.turnsSince) foot += ` <button class="btn" type="button" data-act="distill">${esc(T.refreshNew(v.turnsSince))} <kbd>R</kbd></button>`;
    }
    const g = v.tasksAreRough ? null : v.growth;
    const colon = T.lang === "zh" ? "：" : ": ";
    const growth = g
      ? `<div class="growth">` +
        (g.highlight ? `<p class="growth-line is-good"><b>${esc(T.growthGood)}</b><span>${esc(g.highlight)}</span></p>` : "") +
        (g.applied || [])
          .map((a, i) => `<button class="growth-line is-applied" type="button" data-act="applied" data-n="${i}"><b>${esc(T.growthUsed)}</b><span>${esc(T.growthUsedText(a.title))}${a.how ? colon + esc(a.how) : ""}</span></button>`)
          .join("") +
        (g.next ? `<p class="growth-line is-next"><b>${esc(T.growthNext)}</b><span>${esc(g.next)}</span></p>` : "") +
        `</div>`
      : "";
    el.stage.innerHTML = `
      <section class="overview">
        <h2 class="overview-title">${esc(title)}</h2>
        ${growth}
        <p class="overview-key">${key}</p>
        <div class="flow"></div>
        <div class="overview-foot">${foot}</div>
      </section>`;
    // The stars come in from the top when the page is shown or what is drawn
    // changes, not on every redraw.
    const drawn = `${v.day}|${v.tasks.length}|${(v.dots || []).map((d) => d.id + d.status).join()}`;
    const arriving = drawn !== lastDrawn;
    lastDrawn = drawn;
    // The river takes the height the rest of the view leaves it.
    const overview = el.stage.querySelector(".overview");
    const box = getComputedStyle(el.stage);
    const room = el.stage.clientHeight - parseFloat(box.paddingTop) - parseFloat(box.paddingBottom) - overview.scrollHeight;
    drawGalaxy(overview.querySelector(".flow"), v.tasks, v.activity, v.dots || [], arriving, Math.min(600, Math.max(300, room - 4)));
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

  // The day as a river of stars running down the sky, morning at the top.
  // Every question asked is one small star at its hour, and the river glows
  // wider where the asking was thick. Beside the point where each thing
  // began sit the stars it yielded, one per thing worth keeping, in its
  // kind's colour: solid and glowing once kept, an outline while it waits, a
  // faint small one if it was let go.
  function drawGalaxy(box, tasks, activity, dots, arriving, height) {
    const W = Math.max(300, box.clientWidth);
    const narrow = W < 760;
    const cx = narrow ? 30 : W / 2;
    const amp = narrow ? 4 : 30;
    const top = 22; // the river runs from here to H - top; times sit in the gaps
    const pad = 46;
    let H = Math.round(height);

    // The span of the day: from the first sign of work to the last.
    const times = [];
    if (activity) times.push(minutesOf(activity.from), minutesOf(activity.to));
    for (const t of tasks) times.push(minutesOf(t.from), minutesOf(t.to));
    const known = times.filter((x) => x != null);
    const t0 = known.length ? Math.min(...known) : 9 * 60;
    const t1 = Math.max(t0 + 60, known.length ? Math.max(...known) : 18 * 60);

    // Each task where the river had reached when it began; tasks without
    // hours spread evenly. A task never lands on top of the one before; the
    // river grows longer instead. Stars nobody could place gather at the end.
    const placed = tasks.map((t, i) => ({ t, i, at: minutesOf(t.from), dots: dots.filter((d) => d.task === i) }));
    const timed = placed.some((p) => p.at != null);
    if (timed) placed.sort((p, q) => (p.at == null) - (q.at == null) || (p.at || 0) - (q.at || 0));
    const loose = dots.filter((d) => d.task < 0 || d.task >= tasks.length);
    if (loose.length) placed.push({ t: null, i: -1, at: null, dots: loose });
    // Side by side, a label only has to clear the one two back. In a short
    // window the tasks draw closer together before the river grows longer.
    const tail = 92; // room for the last one's words
    const gap = narrow ? 112 : Math.min(72, Math.max(58, (H - pad - tail) / Math.max(1, placed.length - 1)));
    let last = -Infinity;
    placed.forEach((p, n) => {
      const want = p.at != null ? pad + ((p.at - t0) / (t1 - t0)) * (H - 2 * pad) : p.t ? pad + (n + 0.5) * ((H - 2 * pad) / placed.length) : H - pad;
      // No lower than leaves room for the ones still to come.
      const cap = H - tail - (placed.length - 1 - n) * gap;
      p.y = Math.max(Math.min(Math.max(want, last + gap), Math.max(cap, last + gap)), pad);
      last = p.y;
    });
    if (last > H - tail) H = Math.round(last + tail);

    // Time to height, through the tasks' own positions, so each question's
    // star lands beside the task it was asked during.
    const marks = [[pad, t0], ...placed.filter((p) => p.at != null).map((p) => [p.y, p.at]), [H - pad, t1]];
    const raw = activity && activity.bins.length ? activity.bins : null;
    const a0 = activity ? minutesOf(activity.from) : null;
    // The river's course: one long bend with a smaller one laid over it, so
    // that it wanders rather than snakes.
    const xAt = (y) => cx + amp * (0.72 * Math.sin(y / 150 + 0.6) + 0.28 * Math.sin(y / 57 + 2.2));
    const f = (n) => n.toFixed(1);

    // The caught stars first, so the small ones can leave room around them.
    const R = narrow ? 9 : 13;
    const clusters = placed.map((p) => {
      const x = xAt(p.y);
      const shown = p.dots.slice(0, 8);
      const k = shown.length;
      const ring = k <= 1 ? 0 : R * (0.72 + 0.22 * k);
      const at = shown.map((d, j) => {
        const a = (k === 2 ? 0 : -Math.PI / 2) + (j / Math.max(1, k)) * Math.PI * 2;
        return [x + ring * Math.cos(a), p.y + ring * Math.sin(a)];
      });
      const parts = shown.map((d, j) => {
        const size = d.status === "skipped" ? R * 0.5 : R;
        const label = [T.kinds[d.kind], d.title].filter(Boolean).join(" · ");
        return `<g class="star is-${d.status}" data-kind="${esc(d.kind)}" data-act="dot" data-id="${esc(d.id)}" transform="translate(${f(at[j][0])} ${f(at[j][1])})"><title>${esc(label)}</title><g class="inner">` +
          `<circle class="halo" r="${f(R * 1.2)}" filter="url(#glow)"/>` +
          `<path class="body" d="${STAR}" transform="scale(${f(size)})"/>` +
          `<circle class="core" r="${f(R * 0.15)}"/>` +
          `<circle class="hoop" r="${f(R * 1.45)}"/>` +
          `<circle class="hit" r="${f(R * 1.3)}"/></g></g>`;
      });
      // The stars of one thing are joined up, like a small constellation.
      if (k >= 2) parts.unshift(`<polyline class="constel" points="${[...at, ...(k > 2 ? [at[0]] : [])].map(([px, py]) => `${f(px)},${f(py)}`).join(" ")}"/>`);
      // A thing that left nothing to keep still marks its place.
      if (!k) parts.push(`<circle class="mark" cx="${f(x)}" cy="${f(p.y)}" r="${narrow ? 3.5 : 4.5}"/>`);
      const reach = (k ? ring + R : 5) + 6;
      return { p, x, reach, html: parts.join("") };
    });

    // Every question asked is a small star at its hour, scattered a little
    // to either side and never on top of another: thick and wide where the
    // asking was, a thin trail in the quiet hours.
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
    // Each half hour gets the stretch of river its hour maps to, and spreads
    // sideways as far as it needs for every question to have its own star.
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
        const r = 1.2 + rnd() * 1.4;
        for (let tries = 0; tries < 24; tries++) {
          const y = sp.ya + rnd() * (sp.yb - sp.ya);
          const side = rnd() * 2 - 1;
          const x = xAt(y) + Math.sign(side) * Math.pow(Math.abs(side), 0.85) * (sp.half + tries * 1.5);
          if (taken.some(([tx, ty, tr]) => Math.hypot(x - tx, y - ty) < r + tr + 1.4)) continue;
          taken.push([x, y, r]);
          html.push(`<circle class="s${Math.floor(rnd() * 3)}${rnd() < 0.16 ? " tw" : ""}" cx="${f(x)}" cy="${f(y)}" r="${f(r)}"/>`);
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
      // Clear of the small stars along the whole height of the words, not
      // just the first line, going by where they actually landed.
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
      <canvas class="current" aria-hidden="true"></canvas>
      <svg class="galaxy" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
        <defs>
          <filter id="glow" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="${narrow ? 4 : 6}"/></filter>
        </defs>
        <g class="specks" aria-hidden="true">${specks.map((g) => `<g class="ht-row">${g.html}</g>`).join("")}</g>
        <text class="ends" x="${f(xAt(top))}" y="12" aria-hidden="true">${esc(hhmmOf(t0))}</text>
        <text class="ends" x="${f(xAt(H - top))}" y="${H - 4}" aria-hidden="true">${esc(hhmmOf(t1))}</text>
        <g aria-hidden="true">${ties.join("")}</g>
        ${clusters.map((c) => `<g class="cluster">${c.html}</g>`).join("")}
      </svg>
      ${cards.map((c) => c.html).join("")}`;
    // The river itself is painted under the stars, and moves.
    flowRiver(box.querySelector(".current"), { W, H, top, narrow, xAt, spans });
    // Placed and timed through the CSSOM: the page's CSP forbids inline styles.
    // As the page arrives the stars come in from the top, as the day did.
    const delay = (y) => `${((y / H) * 1.1).toFixed(2)}s`;
    box.querySelectorAll(".ht-row").forEach((g, n) => (g.style.animationDelay = delay(specks[n].y)));
    box.querySelectorAll(".specks .tw").forEach((c, n) => (c.style.animationDelay = `${((n * 0.83) % 3.4).toFixed(2)}s`));
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

  // The river of light the day's stars lie in, painted on a canvas so that
  // it can flow. It is a thread in the quiet hours and a broad reach where a
  // half hour was busy; its edges are cloud, not a line; and it comes in
  // from above the day and runs on past the end of it, fading at both. Dust
  // drifts down it all the while, morning to night, and slow clouds of
  // light with it. The stars that stand for questions stay where they are.
  function flowRiver(canvas, river) {
    const { W, H, top, narrow, xAt, spans } = river;
    const ext = 60; // how far past each end of the day it reaches
    const full = H + 2 * ext; // the canvas is this tall; its y is the day's y + ext
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(full * dpr);
    canvas.style.top = `${-ext}px`;
    canvas.style.height = `${full}px`;

    let seed = 20261110;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // the same river every time
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(Math.PI * 2 * rnd());
    const ease = (a, b, v) => {
      const k = Math.max(0, Math.min(1, (v - a) / (b - a)));
      return k * k * (3 - 2 * k);
    };

    // How wide and how bright it runs at each height, sampled down its length
    // and smoothed, so that it swells and narrows the way water does.
    const STEP = 4;
    const n = Math.ceil(full / STEP) + 2;
    const wide = new Float32Array(n);
    const glow = new Float32Array(n);
    const thin = narrow ? 8 : 19;
    const most = narrow ? 34 : 108;
    for (let i = 0; i < n; i++) {
      const y = i * STEP - ext;
      let w = thin;
      let b = 0.4;
      for (const sp of spans) {
        if (!sp.count) continue;
        const reach = (sp.yb - sp.ya) / 2 + (narrow ? 16 : 30);
        const near = Math.exp(-Math.pow((y - (sp.ya + sp.yb) / 2) / reach, 2));
        w = Math.max(w, thin + (Math.min(most, sp.half + (narrow ? 8 : 24)) - thin) * near);
        b = Math.max(b, 0.4 + Math.min(0.6, 0.18 + sp.count * 0.08) * near);
      }
      wide[i] = w;
      glow[i] = b;
    }
    for (const arr of [wide, glow]) {
      for (let pass = 0; pass < 2; pass++) {
        const src = Float32Array.from(arr);
        for (let i = 0; i < n; i++) {
          let sum = 0;
          let count = 0;
          for (let k = -4; k <= 4; k++) if (i + k >= 0 && i + k < n) (sum += src[i + k]), count++;
          arr[i] = sum / count;
        }
      }
    }
    const at = (arr, y) => {
      const pos = Math.max(0, Math.min(n - 1.001, (y + ext) / STEP));
      const i = Math.floor(pos);
      return arr[i] + (arr[i + 1] - arr[i]) * (pos - i);
    };
    // Faint where it comes into view and where it leaves.
    const fade = (y) => Math.min(ease(-ext, top + 14, y), 1 - ease(H - top - 14, H + ext, y));

    // A puff of light is one soft round sprite per colour, drawn at whatever
    // size and strength is wanted. (Painting each as a faint gradient of its
    // own leaves the browser's dither showing through as a lattice once a
    // few hundred are laid over one another.)
    const TINTS = ["142,156,255", "142,156,255", "168,150,255", "122,172,255", "222,162,236", "116,212,226", "198,208,255"];
    const tint = () => TINTS[Math.floor(rnd() * (TINTS.length - 1))];
    const sprites = new Map();
    for (const rgb of new Set(TINTS)) {
      const sprite = document.createElement("canvas");
      sprite.width = sprite.height = 128;
      const sg = sprite.getContext("2d");
      const light = sg.createRadialGradient(64, 64, 0, 64, 64, 64);
      for (const [stop, alpha] of [[0, 1], [0.2, 0.78], [0.45, 0.36], [0.7, 0.1], [1, 0]]) light.addColorStop(stop, `rgba(${rgb},${alpha})`);
      sg.fillStyle = light;
      sg.beginPath();
      sg.arc(64, 64, 64, 0, Math.PI * 2);
      sg.fill();
      sprites.set(rgb, sprite);
    }
    const puff = (g, x, y, radius, rgb, alpha) => {
      g.globalAlpha = Math.min(1, alpha);
      g.drawImage(sprites.get(rgb), x - radius, y - radius, radius * 2, radius * 2);
    };

    // What does not move is painted once: soft puffs of light scattered to
    // either side, so the edge is ragged cloud, with a brighter middle. It is
    // painted small and strong and laid down large and faint, which keeps it
    // smooth where it is dimmest.
    const SMALL = 0.5;
    const STRONG = 2;
    const still = document.createElement("canvas");
    still.width = Math.ceil(W * SMALL);
    still.height = Math.ceil(full * SMALL);
    const bed = still.getContext("2d");
    bed.scale(SMALL, SMALL);
    bed.globalCompositeOperation = "lighter";
    for (let y = -ext; y <= H + ext; y += 9) {
      const w = at(wide, y);
      const b = at(glow, y) * fade(y) * STRONG;
      if (b < 0.02) continue;
      for (let k = 0; k < 2; k++) puff(bed, xAt(y) + gauss() * w * 0.5, y + ext + gauss() * 8, w * (0.62 + rnd() * 0.8) + 16, tint(), (0.035 + rnd() * 0.05) * b);
      puff(bed, xAt(y) + gauss() * w * 0.14, y + ext, w * 0.4 + 9, "198,208,255", 0.07 * b);
      // And a wide, very faint spread around it all, so it has no outline.
      if (!narrow) puff(bed, xAt(y) + gauss() * w * 0.7, y + ext + gauss() * 10, w * 1.7 + 46, tint(), 0.014 * b);
    }

    // What moves: slow clouds of light, and dust, all going downstream.
    const clouds = Array.from({ length: narrow ? 8 : 16 }, () => ({ u: rnd() * full, side: gauss() * 0.42, size: 0.6 + rnd() * 0.8, speed: 5 + rnd() * 7, alpha: 0.05 + rnd() * 0.07, rgb: tint() }));
    const dust = Array.from({ length: narrow ? 70 : Math.max(130, Math.min(260, Math.round(full / 2.4))) }, () => ({
      u: rnd() * full,
      side: gauss() * 0.6,
      speed: 7 + rnd() * 19,
      size: 0.35 + rnd() * rnd() * 0.8,
      alpha: 0.14 + rnd() * 0.46,
      phase: rnd() * Math.PI * 2,
      streak: rnd() < 0.08, // a few leave a short trail, which is what says "flowing"
    }));

    const g = canvas.getContext("2d");
    function paint(t) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      g.clearRect(0, 0, W, full);
      g.imageSmoothingQuality = "high";
      g.globalAlpha = 1 / STRONG;
      g.drawImage(still, 0, 0, W, full);
      g.globalCompositeOperation = "lighter";
      for (const c of clouds) {
        const yc = (c.u + c.speed * t) % full;
        const y = yc - ext;
        const b = at(glow, y) * fade(y);
        if (b < 0.02) continue;
        const w = at(wide, y);
        puff(g, xAt(y) + c.side * w, yc, (w * 1.1 + 20) * c.size, c.rgb, c.alpha * b);
      }
      g.globalAlpha = 1;
      g.lineCap = "round";
      for (const d of dust) {
        const yc = (d.u + d.speed * t) % full;
        const y = yc - ext;
        const seen = fade(y);
        if (seen < 0.02) continue;
        const sway = d.side + 0.05 * Math.sin(t * 0.5 + d.phase);
        const x = xAt(y) + sway * at(wide, y);
        const alpha = d.alpha * seen * (0.72 + 0.28 * Math.sin(t * 1.3 + d.phase));
        if (d.streak) {
          const back = y - d.speed * 0.32;
          g.strokeStyle = `rgba(232,238,255,${(alpha * 0.34).toFixed(3)})`;
          g.lineWidth = d.size * 1.2;
          g.beginPath();
          g.moveTo(xAt(back) + sway * at(wide, back), back + ext);
          g.lineTo(x, yc);
          g.stroke();
        }
        g.fillStyle = `rgba(232,238,255,${alpha.toFixed(3)})`;
        g.beginPath();
        g.arc(x, yc, d.size, 0, Math.PI * 2);
        g.fill();
      }
    }

    paint(0);
    if (reducedMotion()) return; // one still frame
    let t = 0;
    let last = performance.now();
    const frame = (now) => {
      if (!canvas.isConnected) return; // the view was redrawn, or left: this river is gone
      requestAnimationFrame(frame);
      // Something this slow is as smooth at thirty frames a second as at sixty.
      if (now - last < 30) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!el.rest.hidden) return; // out of sight behind a rest
      t += dt;
      paint(t);
    };
    requestAnimationFrame(frame);
  }

  // The far stars, painted once for the size of the window; a few nearer
  // ones are elements of their own, so they can twinkle.
  function paintSky() {
    const canvas = $("sky");
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const g = canvas.getContext("2d");
    g.scale(dpr, dpr);
    let seed = 20261110;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // the same sky every time
    const count = Math.round((w * h) / 5200);
    for (let i = 0; i < count; i++) {
      const tint = rnd();
      const alpha = 0.2 + rnd() * 0.62;
      g.fillStyle = tint < 0.1 ? `rgba(255,222,186,${alpha})` : tint < 0.3 ? `rgba(176,204,255,${alpha})` : `rgba(255,255,255,${alpha})`;
      g.beginPath();
      g.arc(rnd() * w, rnd() * h, 0.35 + Math.pow(rnd(), 3) * 1.2, 0, Math.PI * 2);
      g.fill();
    }
    const near = $("twinkles");
    if (!near.childElementCount) {
      for (let i = 0; i < 16; i++) {
        const star = document.createElement("i");
        star.style.left = `${(rnd() * 100).toFixed(2)}%`;
        star.style.top = `${(rnd() * 100).toFixed(2)}%`;
        star.style.setProperty("--d", `${(3 + rnd() * 4).toFixed(1)}s`);
        star.style.setProperty("--t", `${(-rnd() * 6).toFixed(1)}s`);
        near.appendChild(star);
      }
    }
  }

  // ---------------------------------------------------------------- rest

  // Asked to step away every so often. While a rest runs the page gives way
  // to a quiet sky and the time left; as it runs out, what the stretch
  // before it held comes up underneath, so going back starts from knowing
  // where everything stands.
  const rest = { status: null, recap: null, asked: false, over: false, ticker: null, offset: 0, pop: false, line: 0 };
  let restTab = params.has("rest"); // a tab the host opened just for this rest

  const notifies = () => inBrowser && typeof Notification !== "undefined" && Notification.permission === "granted";

  async function pollRest() {
    if (!api.rest) return;
    try {
      applyRest(await api.rest({ visible: !document.hidden, notifies: notifies() }));
    } catch {
      // the host is away; the next asking will tell
    }
  }

  function applyRest(s) {
    if (!s) return;
    const was = rest.status ? rest.status.phase : "idle";
    rest.status = s;
    rest.offset = Date.now() - s.now; // this page's clock against the host's
    if (s.phase === "resting" && was !== "resting") enterRest();
    else if (s.phase !== "resting" && was === "resting") leaveRest();
    renderRestButton();
    renderRestPop();
  }

  function restLeft() {
    return Math.max(0, rest.status.endsAt + rest.offset - Date.now());
  }

  function mmss(ms) {
    const secs = Math.ceil(ms / 1000);
    return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  }

  function enterRest() {
    rest.recap = null;
    rest.asked = false;
    rest.line = (rest.status.count || 0) % T.restLines.length;
    closeCal();
    closeRestPop();
    el.rest.hidden = false;
    renderRest();
    clearInterval(rest.ticker);
    rest.ticker = setInterval(tickRest, 1000);
    tickRest();
    // In a tab nobody is looking at: say so where it will be seen.
    if (document.hidden && notifies()) {
      try {
        const note = new Notification(T.restNotifyTitle, { body: T.restNotifyBody, tag: "dotjar-rest" });
        note.onclick = () => {
          window.focus();
          note.close();
        };
      } catch {
        // the browser would not; the page still shows it
      }
    }
  }

  function leaveRest() {
    clearInterval(rest.ticker);
    el.rest.hidden = true;
    el.rest.innerHTML = "";
  }

  function tickRest() {
    const s = rest.status;
    if (!s || s.phase !== "resting") return;
    const left = restLeft();
    // The look back comes up as the rest runs out: in its last minute, or
    // its last third when it is a short one.
    if (!rest.asked && left <= Math.min(60000, (s.endsAt - s.startedAt) / 3)) {
      rest.asked = true;
      loadRecap();
    }
    const over = left <= 0;
    if (over !== rest.over) return void renderRest();
    const count = el.rest.querySelector(".rest-count");
    if (count) count.textContent = over ? "" : mmss(left);
  }

  async function loadRecap() {
    try {
      rest.recap = await api.restRecap();
    } catch {
      rest.recap = null;
    }
    if (rest.status && rest.status.phase === "resting") renderRest();
  }

  // What the stretch held, as a board: what waits on the person first, then
  // what an agent is still on, then what is wrapped up.
  function recapHtml(r) {
    const card = (t) => `
      <article class="thing">
        <b class="thing-title">${esc(t.title)}</b>
        <span class="thing-meta">${esc([t.project, t.agent, t.asks ? T.asks(t.asks) : T.recapEarlier].filter(Boolean).join(" · "))}</span>
        ${t.ask ? `<p><b class="who is-you">${esc(T.you)}</b><span>${esc(t.ask)}${t.latest ? ` … ${esc(t.latest)}` : ""}</span></p>` : ""}
        ${t.reply ? `<p><b class="who is-ai">${esc(T.ai)}</b><span>${esc(t.reply)}</span></p>` : ""}
        <div class="strip" title="${esc(t.from)}–${esc(t.to)}">${(t.marks || []).map((m) => `<i data-at="${Number(m) || 0}"></i>`).join("")}</div>
      </article>`;
    const board = ["waiting", "running", "done"]
      .map((state) => {
        const list = r.things.filter((t) => t.state === state);
        return `<div class="col" data-state="${state}"><h4><i></i>${esc(T.recapCols[state])}<b>${list.length}</b></h4>${list.map(card).join("") || `<p class="col-none">${esc(T.recapEmptyCol)}</p>`}</div>`;
      })
      .join("");
    const stop = T.lang === "zh" ? "。" : ". ";
    const more = [r.waiting ? `<b>${esc(T.recapWaiting(r.waiting))}</b>` : "", r.running ? esc(T.recapRunning(r.running)) : ""].filter(Boolean).join(T.lang === "zh" ? "，" : ", ");
    return `
      <section class="recap">
        <h3 class="recap-title">${esc(T.recapTitle(r.minutes))}<span>${esc(r.from)}–${esc(r.to)}</span></h3>
        ${
          r.things.length
            ? `<p class="recap-sum">${esc(T.recapSum(r.asks, r.things.length + (r.more || 0)))}${more ? stop + more : ""}</p>
               <div class="board">${board}</div>
               <p class="recap-ask">${esc(T.recapAsk)}</p>`
            : `<p class="recap-sum">${esc(T.recapNone)}</p>`
        }
      </section>`;
  }

  function renderRest() {
    const s = rest.status;
    if (!s || s.phase !== "resting") return;
    const left = restLeft();
    const over = left <= 0;
    rest.over = over;
    el.rest.classList.toggle("has-recap", Boolean(rest.recap));
    const foot = over
      ? `<button class="btn primary" type="button" data-rest="done">${esc(T.restBack)} <kbd>↵</kbd></button>`
      : `<button class="btn" type="button" data-rest="skip">${esc(T.restSkip)} <kbd>esc</kbd></button>
         <button class="btn" type="button" data-rest="snooze">${esc(T.restSnooze(5))}</button>`;
    el.rest.innerHTML = `
      <div class="rest-inner">
        <p class="rest-clock">${hhmm(Date.now())} · ${esc(T.restCount((s.count || 0) + 1))}</p>
        <h2 class="rest-head">${esc(over ? T.restOver : T.restHead)}</h2>
        <p class="rest-line">${esc(T.restLines[rest.line] || "")}</p>
        <div class="rest-rule"></div>
        <p class="rest-count">${over ? "" : mmss(left)}</p>
        ${rest.recap ? recapHtml(rest.recap) : ""}
        <div class="rest-foot">${foot}</div>
      </div>`;
    el.rest.querySelectorAll(".strip i").forEach((tick) => (tick.style.left = `${Math.min(1, Math.max(0, Number(tick.dataset.at))) * 100}%`));
  }

  async function restAct(name) {
    const call = { done: api.restDone, skip: api.restSkip, snooze: api.restSnooze, start: api.restStart }[name];
    if (!call) return;
    try {
      applyRest(await call());
    } catch (err) {
      toast(errorText(err));
      return;
    }
    // A tab opened only for this rest closes again where the browser lets
    // it; otherwise it carries on as the page.
    if (name !== "start" && restTab) {
      restTab = false;
      try {
        history.replaceState(null, "", location.pathname);
      } catch {
        // a plain file has no address to tidy
      }
      window.close();
    }
  }

  function renderRestButton() {
    const s = rest.status;
    el.restBtn.hidden = !s;
    if (!s) return;
    const mins = s.dueAt ? Math.max(0, Math.round((s.dueAt + rest.offset - Date.now()) / 60000)) : 0;
    el.restBtn.classList.toggle("is-on", Boolean(s.enabled));
    el.restBtn.innerHTML = `${MOON}<span class="lbl">${esc(T.restBtn)}</span><small>${esc(s.enabled ? T.restIn(mins) : T.restOff)}</small>`;
    el.restBtn.setAttribute("aria-expanded", String(rest.pop));
    el.restBtn.title = T.restSet;
  }

  function renderRestPop() {
    const s = rest.status;
    el.restPop.hidden = !rest.pop || !s;
    if (el.restPop.hidden) return;
    const seg = (name, label, list, current) =>
      `<div class="pop-row"><span>${esc(label)}</span><div class="seg">${[...new Set([...list, current])]
        .sort((a, b) => a - b)
        .map((n) => `<button type="button" data-rest-set="${name}" data-v="${n}" aria-pressed="${n === current}">${esc(T.restMin(n))}</button>`)
        .join("")}</div></div>`;
    el.restPop.innerHTML = `
      <h3>${esc(T.restSet)}</h3>
      <div class="seg">
        <button type="button" data-rest-set="enabled" data-v="1" aria-pressed="${Boolean(s.enabled)}">${esc(T.restOn)}</button>
        <button type="button" data-rest-set="enabled" data-v="0" aria-pressed="${!s.enabled}">${esc(T.restOff)}</button>
      </div>
      ${seg("everyMin", T.restEvery, s.choices.every, s.everyMin)}
      ${seg("forMin", T.restFor, s.choices.for, s.forMin)}
      <p class="pop-note">${esc(T.restHint)}</p>
      <div class="pop-foot"><button class="btn" type="button" data-rest="start">${esc(T.restNow)}</button></div>`;
  }

  function closeRestPop() {
    if (!rest.pop) return;
    rest.pop = false;
    renderRestPop();
    renderRestButton();
  }

  async function setRest(name, value) {
    const patch = { [name]: name === "enabled" ? value === "1" : Number(value) };
    try {
      const was = rest.status && rest.status.enabled;
      applyRest(await api.setRest(patch));
      const s = rest.status;
      if (name === "enabled" && s.enabled && !was) {
        // Asked for while there is a click to hang it on: with it, a rest
        // that falls due while the tab is in the background can say so.
        if (inBrowser && typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => {});
        toast(T.restSaved(s.everyMin));
      } else if (name === "enabled" && !s.enabled) toast(T.restStopped);
    } catch (err) {
      toast(errorText(err));
    }
  }

  // ------------------------------------------------------------- actions  // ------------------------------------------------------------- actions

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

  // Something kept earlier that was put to use today opens where it is kept.
  function openApplied(n) {
    const a = state.view && state.view.growth && (state.view.growth.applied || [])[n];
    if (a && a.file) actions.library(window.DotjarMarkdown.anchorFor(a.file));
    else actions.library();
  }

  // A star on the river opens what it stands for: the card if it still
  // waits, its page in the jar if it was kept.
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

  // The kept card becomes a star and flies up into the jar.
  async function dropDot(kind) {
    const from = el.stage.querySelector(".card .kind .dot");
    const to = el.library.querySelector(".ico");
    if (!from || !to || reducedMotion()) return;
    const a = from.getBoundingClientRect();
    const c = to.getBoundingClientRect();
    const star = document.createElement("i");
    star.className = "fly";
    star.dataset.kind = kind;
    document.body.appendChild(star);
    const anim = star.animate(
      [
        { transform: `translate(${a.left - 2}px, ${a.top - 2}px) scale(1.5) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${(a.left + c.left) / 2}px, ${Math.min(a.top, c.top) - 30}px) scale(1.9) rotate(120deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${c.left + c.width / 2 - 8}px, ${c.top + c.height / 2 - 6}px) scale(0.5) rotate(200deg)`, opacity: 0.3 },
      ],
      { duration: 640, easing: "cubic-bezier(0.3, 0, 0.2, 1)", fill: "forwards" }
    );
    // A hidden window produces no frames; never let the keep wait on one.
    await Promise.race([anim.finished.catch(() => {}), sleep(760)]);
    star.remove();
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
      if (verb === "keep") state.bump = state.bumpJar = true;
      setView(v);
      render();
      // The next card glides in from where it was peeking; the decided one is gone.
      if (!reducedMotion() && state.tab === "open") glideDeck({ ...from, card: null }, list[i + 1] ? 1 : -1);
      if (verb === "keep") {
        const kept = v.kept.find((k) => k.id === cur.id);
        // Some stars are worth a word: the first, and every round number after.
        const total = v.jar ? v.jar.total : 0;
        const marked = total === 1 ? T.jarFirst : [10, 25, 50, 100, 200, 300, 500, 1000].includes(total) ? T.jarNth(total) : "";
        toast(marked || T.keptTo(shortPath((kept && kept.fileLabel) || v.depositDir, 60)), cur.id);
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
    // Asked for by name, today is shown even while it is still empty; left
    // alone, the page shows the last day that had work in it.
    state.pick = key;
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
    if (act && act.dataset.act === "applied") return void openApplied(Number(act.dataset.n));
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
  // A click anywhere else puts the calendar away, and the rest settings too.
  document.addEventListener("click", () => {
    closeCal();
    closeRestPop();
  });
  el.restBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeCal();
    rest.pop = !rest.pop;
    renderRestPop();
    renderRestButton();
  });
  el.restPop.addEventListener("click", (e) => {
    e.stopPropagation();
    const set = e.target.closest("[data-rest-set]");
    if (set) return void setRest(set.dataset.restSet, set.dataset.v);
    const go = e.target.closest("[data-rest]");
    if (go) {
      closeRestPop();
      restAct(go.dataset.rest);
    }
  });
  el.rest.addEventListener("click", (e) => {
    e.stopPropagation();
    const go = e.target.closest("[data-rest]");
    if (go) restAct(go.dataset.rest);
  });
  el.engine.addEventListener("click", switchEngine);

  document.addEventListener("keydown", (e) => {
    // During a rest the keys belong to it: out early, or back when it is over.
    if (rest.status && rest.status.phase === "resting") {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") restAct(rest.over ? "done" : "skip");
      else if (e.key === "Enter" && rest.over && !(document.activeElement && document.activeElement.tagName === "BUTTON")) restAct("done");
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
      e.preventDefault();
      paste();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (rest.pop) {
      if (e.key === "Escape") closeRestPop();
      return;
    }
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
    lastDrawn = ""; // the stars come in again
    refresh();
    pollRest();
  }

  if (api.onShown) api.onShown(entered);
  if (api.onCaptured) api.onCaptured(refresh);
  window.addEventListener("resize", () => {
    paintSky();
    if (state.tab === "today") renderStage(); // the river is drawn to the window's size
    else fitPhrases(el.stage.querySelector(".card-title"));
  });

  // Asked now and then whether a rest is due; a tab in the background is
  // only let run about once a minute, which is often enough.
  setInterval(pollRest, 15000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pollRest();
  });

  paintSky();
  render();
  if (host && !inBrowser) refresh(); // the desktop app announces each showing itself
  else entered();
})();
