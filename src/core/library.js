"use strict";

// The library: everything that has settled, gathered into one self-contained
// HTML page that opens in any browser. It is rebuilt from the Markdown notes
// in the deposit folder (the notes stay the source of truth) plus the ledger's
// record of what agents wrote on their own.

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const config = require("./config");
const ledger = require("./ledger");
const markdown = require("../overlay/markdown");
const words = require("../overlay/words");

// The four kinds a pass over a day turns up, then the four places an agent
// writes to by itself.
const KINDS = ["craft", "strategy", "lesson", "trap", "note", "rule", "skill", "memory"];
const CHART_DAYS = 60;
const PART_LIMIT = 9000; // characters of a file shown on its card

const { isLinkLine, cleanGist } = require("./durable");

function libraryPath() {
  return path.join(config.dataDir(), "library.html");
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function dayKeyOf(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// The small subset of YAML the deposits use: `key: value` and `key: [a, b]`.
function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const raw = kv[2].trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      meta[kv[1]] = raw
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      meta[kv[1]] = raw.replace(/^["']|["']$/g, "");
    }
  }
  return { meta, body: text.slice(match[0].length) };
}

function parseNote(file, text, stat) {
  const { meta, body } = parseFrontmatter(text);
  let rest = body;
  let title = path.basename(file).replace(/\.(md|markdown)$/i, "");
  const heading = /^\s*#\s+(.+?)\s*$/m.exec(rest);
  if (heading && rest.slice(0, heading.index).trim() === "") {
    title = heading[1];
    rest = rest.slice(heading.index + heading[0].length);
  }
  let payoff = "";
  rest = rest.replace(/^\*\*(?:什么时候用上|Useful when)\*\*[:：]\s*(.+)$/m, (_m, p) => {
    payoff = p.trim();
    return "";
  });
  const created = /^\d{4}-\d{2}-\d{2}$/.test(meta.created || "") ? meta.created : dayKeyOf(new Date(stat.mtimeMs));
  return {
    file,
    title,
    payoff,
    kind: KINDS.includes(meta.kind) ? meta.kind : "note",
    day: created,
    projects: Array.isArray(meta.projects) ? meta.projects : [],
    html: markdown.render(rest.trim()),
    mtime: stat.mtimeMs,
  };
}

function readNotes(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const notes = [];
  for (const name of names) {
    if (!/\.(md|markdown)$/i.test(name)) continue;
    const file = path.join(dir, name);
    try {
      const stat = fs.statSync(file);
      if (stat.isFile()) notes.push(parseNote(file, fs.readFileSync(file, "utf8"), stat));
    } catch {
      // A note that cannot be read is left out rather than failing the page.
    }
  }
  return notes;
}

function vaultOf(file) {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".obsidian"))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

function links(file) {
  const out = { file: pathToFileURL(file).href, obsidian: null };
  if (vaultOf(file)) out.obsidian = `obsidian://open?path=${encodeURIComponent(file)}`;
  return out;
}

// --------------------------------------------- what an agent wrote, in full

// Loose text for finding a stored heading in its file again: no spacing,
// quotes, markup or punctuation, and no "…" where it was shortened.
function squash(text) {
  return String(text)
    .toLowerCase()
    .replace(/…$/, "")
    .replace(/[\s"'“”‘’「」『』《》【】*`_#>|…—\-，。：；、,.:;!?！？()（）[\]]+/g, "");
}

function headingOf(line) {
  const m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line.trim());
  return m ? { level: m[1].length, text: m[2] } : null;
}

// The lines a match belongs to: its section if it sits under a heading,
// otherwise its paragraph.
function spanAround(lines, i) {
  let h = -1;
  for (let k = i; k >= 0; k--) {
    if (headingOf(lines[k])) {
      h = k;
      break;
    }
  }
  if (h >= 0) {
    const level = headingOf(lines[h]).level;
    let end = h + 1;
    while (end < lines.length && !(headingOf(lines[end]) && headingOf(lines[end]).level <= level)) end++;
    return [h, end];
  }
  let start = i;
  while (start > 0 && lines[start - 1].trim()) start--;
  let end = i + 1;
  while (end < lines.length && lines[end].trim()) end++;
  return [start, end];
}

function cut(text, limit) {
  if (text.length <= limit) return { text, cut: false };
  const at = text.lastIndexOf("\n\n", limit);
  return { text: text.slice(0, at > limit / 2 ? at : limit), cut: true };
}

// What a card shows for something an agent wrote: the sections it added
// that day when they can be found again (for a new file that is the whole
// of it), otherwise the whole file. Null when all it added was links.
function partOf(pointer) {
  let text;
  try {
    text = fs.readFileSync(pointer.file, "utf8");
  } catch {
    return { title: pointer.title, html: "", gone: true };
  }
  const lines = parseFrontmatter(text).body.replace(/\r\n/g, "\n").split("\n");
  const spans = [];
  let heading = "";
  let linksOnly = true;
  for (const gist of pointer.gists) {
    const want = squash(gist);
    if (want.length < 4) continue;
    const i = lines.findIndex((line) => line.trim() && squash(line).includes(want));
    if (i === -1) continue;
    if (!isLinkLine(lines[i].trim())) linksOnly = false;
    // The card is titled by the section the match sits in, if it has one.
    const span = spanAround(lines, i);
    const h = headingOf(lines[span[0]]);
    if (!heading && h) heading = h.text;
    spans.push(span);
  }
  if (spans.length && linksOnly) return null;

  let body;
  if (spans.length) {
    spans.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [a, b] of spans) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    body = merged.map(([a, b]) => lines.slice(a, b).join("\n").trim()).join("\n\n");
  } else {
    body = lines.join("\n").trim();
  }
  // The card's title already says it; the first heading need not repeat.
  const first = /^#{1,6}\s+(.+?)\s*#*\n/.exec(body + "\n");
  if (first && (squash(first[1]) === squash(heading) || squash(first[1]).includes(squash(pointer.title)))) {
    heading = heading || first[1];
    body = body.slice(first[0].length).trim();
  }
  const shown = cut(body, PART_LIMIT);
  // The file's own heading, so a quote or a word the stored title lost is back;
  // without its numbering and date stamp.
  return { title: heading ? cleanGist(heading, 200) : pointer.title, html: markdown.render(shown.text), cut: shown.cut, gone: false };
}

// Everything the page shows, grouped by day, newest first.
function collect(cfg, language) {
  const notes = readNotes(config.depositDir(cfg));
  const byDay = new Map();
  const dayOf = (key) => {
    if (!byDay.has(key)) byDay.set(key, { day: key, notes: [], pointers: [] });
    return byDay.get(key);
  };
  for (const note of notes) dayOf(note.day).notes.push(note);

  const noteFiles = new Set(notes.map((n) => n.file));
  const hidden = ledger.hiddenPaths();
  for (const bed of ledger.listDays()) {
    for (const s of bed.settled) {
      if (!s.path || noteFiles.has(s.path) || hidden.has(s.path)) continue;
      const pointer = {
        kind: KINDS.includes(s.kind) ? s.kind : "note",
        title: s.title || s.name,
        name: s.name,
        file: s.path,
        more: s.more || 0,
        gists: Array.isArray(s.gists) && s.gists.length ? s.gists : [s.title].filter(Boolean),
        isNew: Boolean(s.isNew),
      };
      pointer.part = partOf(pointer);
      if (pointer.part) dayOf(bed.day).pointers.push(pointer);
    }
  }
  const days = [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
  for (const d of days) d.notes.sort((a, b) => b.mtime - a.mtime);
  return {
    days,
    notes: notes.length,
    pointers: days.reduce((n, d) => n + d.pointers.length, 0),
    depositDir: config.tildify(config.depositDir(cfg)),
    wording: cfg.wording,
    language: language || config.resolveLanguage(cfg),
  };
}

// ----------------------------------------------------------------- render

const esc = markdown.escapeHtml;

function renderChart(model, today, T) {
  const counts = new Map(model.days.map((d) => [d.day, [
    ...d.pointers.map((x) => ({ kind: x.kind, kept: false })),
    ...d.notes.map((x) => ({ kind: x.kind, kept: true })),
  ]]));
  const [y, m, d] = today.split("-").map(Number);
  const cols = [];
  for (let i = CHART_DAYS - 1; i >= 0; i--) {
    const key = dayKeyOf(new Date(y, m - 1, d - i));
    const kinds = counts.get(key) || [];
    const shown = kinds.slice(0, 12);
    cols.push(
      `<div class="col${kinds.length ? "" : " is-empty"}" title="${esc(T.libCount(T.libDay(key)[0], kinds.length))}">` +
        (kinds.length > shown.length ? `<b>+${kinds.length - shown.length}</b>` : "") +
        shown.map((x) => `<i data-kind="${x.kind}"${x.kept ? ' style="clip-path:var(--star);border-radius:0"' : ""}></i>`).join("") +
        `</div>`
    );
  }
  return `<div class="chart" aria-hidden="true">${cols.join("")}</div>`;
}

function renderNote(note, T) {
  const l = links(note.file);
  const from = note.projects.length ? `<span>${esc(T.from(note.projects))}</span>` : "";
  return `
      <article class="item note" id="${markdown.anchorFor(note.file)}" data-kind="${note.kind}" data-by="you">
        <details>
          <summary>
            <i class="dot"></i>
            <span class="t">${esc(note.title)}</span>
            ${note.payoff ? `<span class="p">${esc(note.payoff)}</span>` : ""}
          </summary>
          <div class="md">${note.html}</div>
          <p class="src">
            ${l.obsidian ? `<a href="${esc(l.obsidian)}">${esc(T.libObsidian)}</a>` : ""}
            <a href="${esc(l.file)}">${esc(T.libMarkdown)}</a>
            ${from}
            <button class="rm" type="button" data-file="${esc(note.file)}" hidden>${esc(T.libRemove)}</button>
          </p>
        </details>
      </article>`;
}

// Something an agent wrote on its own, unfolded the same way as a kept note.
function renderPointer(p, T) {
  const part = p.part;
  const where = p.name && part.title !== p.name ? T.libPointer(p.name) : T.libPointerPlain;
  const l = part.gone ? null : links(p.file);
  return `
      <article class="item note by-agent" id="${markdown.anchorFor(p.file)}" data-kind="${p.kind}" data-by="agent">
        <details>
          <summary>
            <i class="dot"></i>
            <span class="t">${esc(part.title)}</span>
            <span class="p">${esc(where + (p.more ? T.rowMore(p.more) : ""))}</span>
          </summary>
          <div class="md">${part.gone ? `<p>${esc(T.libGone)}</p>` : part.html}${part.cut ? `<p class="more">${esc(T.libCut)}</p>` : ""}</div>
          <p class="src">
            ${l && l.obsidian ? `<a href="${esc(l.obsidian)}">${esc(T.libObsidian)}</a>` : ""}
            ${l ? `<a href="${esc(l.file)}">${esc(T.libMarkdown)}</a>` : ""}
            <span>${esc(config.tildify(p.file))}</span>
            <button class="rm" type="button" data-file="${esc(p.file)}" hidden>${esc(T.libHide)}</button>
          </p>
        </details>
      </article>`;
}

function renderPage(model, now = new Date()) {
  // Every word on the page, in the language and wording in use.
  const T = words.copy(model.language, model.wording);
  const gap = T.lang === "zh" ? "" : " "; // Chinese sentences sit flush, English ones need a space
  const today = dayKeyOf(now);
  const stamp = T.libUpdated(today, `${pad(now.getHours())}:${pad(now.getMinutes())}`);
  const totals = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const d of model.days) for (const x of [...d.notes, ...d.pointers]) totals[x.kind]++;

  const days = model.days
    .map((d) => {
      const [date, weekday] = T.libDay(d.day);
      return `
    <section class="day">
      <h2>${esc(date)}<span>${esc(weekday)}</span></h2>
      ${d.notes.map((n) => renderNote(n, T)).join("")}
      ${d.pointers.map((p) => renderPointer(p, T)).join("")}
    </section>`;
    })
    .join("");

  const empty = `
    <section class="blank">
      <p>${esc(T.libEmpty)}${gap}${esc(T.libHowTo(model.depositDir))}</p>
    </section>`;

  // A filter for each kind there is something of.
  const chips = KINDS.filter((k) => totals[k])
    .map((k) => `<button class="chip" type="button" data-kind="${k}" aria-pressed="false"><i class="dot"></i>${esc(T.kinds[k])}<b>${totals[k]}</b></button>`)
    .join("");

  return `<!doctype html>
<html lang="${T.lang === "zh" ? "zh-CN" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(T.library)}</title>
<style>${LIBRARY_CSS}</style>
</head>
<body data-removed="${esc(T.libRemoved)}" data-hidden="${esc(T.libHidden)}" data-undo="${esc(T.undo)}">
<header class="top">
  <h1>${esc(T.library)}</h1>
  <p class="sum">${esc(T.libSummary(model.notes, model.pointers))}${gap}${esc(stamp)}</p>
  ${renderChart(model, today, T)}
</header>
<nav class="bar">
  <input id="q" type="search" placeholder="${esc(T.libSearch)}" autocomplete="off" spellcheck="false">
  <div class="chips">${chips}<button class="chip" type="button" data-by="you" aria-pressed="false">${esc(T.onlyMine)}</button></div>
</nav>
<main>
  ${model.days.length ? days : empty}
  <p class="none" hidden>${esc(T.libNone)}</p>
</main>
<footer>${esc(T.libFooter(model.depositDir, T.library))}</footer>
<div class="snack" role="status" hidden><span></span><button type="button">${esc(T.undo)}</button></div>
<script>${LIBRARY_JS}</script>
</body>
</html>
`;
}

// Same palette and type as the veil (src/overlay/overlay.css); repeated here
// because this page has to stand alone as a single file.
const LIBRARY_CSS = `
@font-face {
  font-family: "dotjar Ming";
  src: url("fonts/huiwen-mincho-titles.woff") format("woff");
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: "dotjar Kai";
  src: local("LXGW WenKai"), local("LXGWWenKai-Regular"), url("fonts/lxgw-wenkai-regular.woff") format("woff");
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: "dotjar Kai";
  src: local("LXGW WenKai Medium"), local("LXGWWenKai-Medium"), url("fonts/lxgw-wenkai-medium.woff") format("woff");
  font-weight: 500 700;
  font-display: swap;
}
:root {
  color-scheme: dark;
  --sky-top: #04050e;
  --sky-mid: #0a0e2b;
  --sky-low: #160f35;
  --veil: 6 7 22;
  --washes:
    radial-gradient(58% 48% at 10% 6%, rgb(96 74 224 / 0.26), transparent 72%), radial-gradient(46% 42% at 94% 16%, rgb(214 72 152 / 0.09), transparent 72%),
    radial-gradient(56% 46% at 84% 100%, rgb(22 164 172 / 0.09), transparent 72%), radial-gradient(48% 40% at 6% 100%, rgb(122 84 224 / 0.1), transparent 72%);
  --glass: rgb(17 19 46 / 0.7);
  --ink: rgb(255 255 255 / 0.95);
  --soft: rgb(228 232 255 / 0.7);
  --faint: rgb(214 220 255 / 0.44);
  --line: rgb(255 255 255 / 0.11);
  --fill: rgb(255 255 255 / 0.075);
  --fill-strong: rgb(255 255 255 / 0.15);
  --glass-edge: rgb(255 255 255 / 0.15);
  --glass-shadow: 0 44px 100px -28px rgb(0 0 0 / 0.75), 0 2px 8px rgb(0 0 0 / 0.35);
  --solid: #fff;
  --on-solid: #0b0d22;
  --craft: #f4d566;
  --strategy: #79d6cc;
  --lesson: #8ea8f0;
  --trap: #f29a9c;
  --memory: #b7a9e6;
  --accent: var(--lesson);
  --sans: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
  --round: ui-rounded, "SF Pro Rounded", var(--sans);
  --hand: "dotjar Kai", "Kaiti SC", "STKaiti", var(--sans);
  --display: "dotjar Ming", var(--hand);
  --star: polygon(50% 0, 60% 40%, 100% 50%, 60% 60%, 50% 100%, 40% 60%, 0 50%, 40% 40%);
}
@media (prefers-color-scheme: light) {
  :root {
    --sky-top: #1a2440;
    --sky-mid: #202c4a;
    --sky-low: #253453;
    --veil: 27 37 62;
    --soft: rgb(230 236 246 / 0.76);
    --faint: rgb(212 222 238 / 0.5);
    --washes:
      radial-gradient(22% 14% at 11% 72%, rgb(150 222 220 / 0.32), transparent 70%), radial-gradient(20% 13% at 91% 62%, rgb(246 214 180 / 0.28), transparent 70%),
      radial-gradient(46% 32% at 7% 74%, rgb(70 166 180 / 0.76), transparent 68%), radial-gradient(44% 30% at 95% 57%, rgb(208 124 146 / 0.56), transparent 68%),
      radial-gradient(62% 34% at 46% 58%, rgb(58 98 160 / 0.78), transparent 70%);
    --glass: rgb(24 34 60 / 0.76);
  }
}
:lang(en){--hand:var(--sans);--display:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif}
*{box-sizing:border-box}
html{background:var(--sky-top)}
body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background:
  radial-gradient(1.6px 1.6px at 9% 16%, rgb(255 255 255 / 0.8), transparent 100%),
  radial-gradient(1.2px 1.2px at 22% 71%, rgb(255 255 255 / 0.55), transparent 100%),
  radial-gradient(1.4px 1.4px at 31% 9%, rgb(190 210 255 / 0.7), transparent 100%),
  radial-gradient(1.1px 1.1px at 43% 88%, rgb(255 255 255 / 0.5), transparent 100%),
  radial-gradient(1.5px 1.5px at 58% 6%, rgb(255 255 255 / 0.6), transparent 100%),
  radial-gradient(1.2px 1.2px at 69% 79%, rgb(255 226 190 / 0.7), transparent 100%),
  radial-gradient(1.7px 1.7px at 81% 22%, rgb(255 255 255 / 0.85), transparent 100%),
  radial-gradient(1.1px 1.1px at 93% 58%, rgb(190 210 255 / 0.6), transparent 100%),
  radial-gradient(1.3px 1.3px at 5% 49%, rgb(255 255 255 / 0.5), transparent 100%),
  radial-gradient(1.2px 1.2px at 88% 91%, rgb(255 255 255 / 0.55), transparent 100%),
  radial-gradient(1.4px 1.4px at 15% 93%, rgb(190 210 255 / 0.6), transparent 100%),
  radial-gradient(1.1px 1.1px at 74% 44%, rgb(255 255 255 / 0.4), transparent 100%),
  radial-gradient(1.6px 1.6px at 17% 36%, rgb(255 255 255 / 0.8), transparent 100%),
  radial-gradient(1.2px 1.2px at 26% 54%, rgb(255 255 255 / 0.55), transparent 100%),
  radial-gradient(1.4px 1.4px at 37% 29%, rgb(190 210 255 / 0.7), transparent 100%),
  radial-gradient(1.1px 1.1px at 48% 12%, rgb(255 255 255 / 0.5), transparent 100%),
  radial-gradient(1.5px 1.5px at 54% 67%, rgb(255 255 255 / 0.6), transparent 100%),
  radial-gradient(1.2px 1.2px at 63% 33%, rgb(255 226 190 / 0.7), transparent 100%),
  radial-gradient(1.7px 1.7px at 72% 95%, rgb(255 255 255 / 0.85), transparent 100%),
  radial-gradient(1.1px 1.1px at 96% 8%, rgb(190 210 255 / 0.6), transparent 100%),
  radial-gradient(1.3px 1.3px at 3% 81%, rgb(255 255 255 / 0.5), transparent 100%),
  radial-gradient(1.2px 1.2px at 85% 67%, rgb(255 255 255 / 0.55), transparent 100%),
  radial-gradient(1.4px 1.4px at 39% 96%, rgb(190 210 255 / 0.6), transparent 100%),
  radial-gradient(1.1px 1.1px at 98% 38%, rgb(255 255 255 / 0.4), transparent 100%),
  var(--washes),
  linear-gradient(to bottom,var(--sky-top),var(--sky-mid) 56%,var(--sky-low))}
body{isolation:isolate;margin:0 auto;max-width:860px;padding:72px 28px 96px;color:var(--ink);font:16px/1.7 var(--sans);-webkit-font-smoothing:antialiased}
[data-kind=craft],[data-kind=rule]{--k:var(--craft)}[data-kind=strategy],[data-kind=skill]{--k:var(--strategy)}[data-kind=lesson],[data-kind=note]{--k:var(--lesson)}[data-kind=trap]{--k:var(--trap)}[data-kind=memory]{--k:var(--memory)}
h1{margin:0;font-family:var(--display);font-size:52px;font-weight:400;letter-spacing:.02em;line-height:1.1}
.sum{margin:14px 0 0;color:var(--soft)}
.chart{display:flex;align-items:flex-end;gap:3px;min-height:44px;margin:34px 0 0;padding-bottom:1px}
.col{flex:1;display:flex;flex-direction:column-reverse;align-items:center;gap:3px;min-width:0}
.col i{width:7px;height:7px;border-radius:50%;background:var(--k);flex:none}
.col.is-empty::after{content:"";width:3px;height:3px;border-radius:50%;background:var(--faint);opacity:.6}
.col b{font:500 10px/1 var(--round);color:var(--faint)}
.bar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:40px -28px 0;padding:14px 28px;background:rgb(var(--veil)/.86);backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4)}
#q{flex:1 1 220px;min-width:0;padding:10px 16px;border:1px solid var(--line);border-radius:999px;background:var(--glass);color:inherit;font:inherit;font-size:15px}
#q:focus-visible,button:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
#q::placeholder{color:var(--faint)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border:1px solid var(--line);border-radius:999px;background:transparent;color:var(--soft);font:inherit;font-size:14px;cursor:pointer}
.chip b{font:500 12.5px/1 var(--round);color:var(--faint)}
.chip:hover{background:var(--fill)}
.chip[aria-pressed=true]{background:var(--solid);border-color:transparent;color:var(--on-solid)}
.chip[aria-pressed=true] b{color:inherit;opacity:.6}
.dot{flex:none;width:12px;height:12px;background:var(--k);clip-path:var(--star)}
.day{margin-top:44px}
.day h2{display:flex;align-items:baseline;gap:10px;margin:0 0 10px;font-family:var(--display);font-size:15px;font-weight:400;color:var(--soft)}
.day h2 span{color:var(--faint)}
.item{position:relative;display:block;border-radius:20px;color:inherit;text-decoration:none}
.note{margin:8px 0;background:var(--glass);box-shadow:inset 0 0 0 1px var(--glass-edge);backdrop-filter:blur(30px) saturate(1.5);-webkit-backdrop-filter:blur(30px) saturate(1.5)}
.note:has(details[open])::before {
  content: "";
  position: absolute;
  inset: 0;
  padding: 1.2px;
  border-radius: inherit;
  background: linear-gradient(135deg, rgb(126 226 182 / 0.75), rgb(140 160 244 / 0.5) 30%, rgb(242 168 190 / 0.6) 58%, rgb(246 228 126 / 0.7) 82%, rgb(126 226 182 / 0.6));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}
summary{display:grid;grid-template-columns:12px minmax(0,1fr);column-gap:12px;align-items:baseline;padding:16px 20px;cursor:pointer;list-style:none}
summary::-webkit-details-marker{display:none}
summary .dot{align-self:start;margin-top:.5em}
.t,.p,.md{font-family:var(--hand);overflow-wrap:anywhere}
.t{font-size:18.5px;font-weight:500;line-height:1.45;letter-spacing:-.005em}
.p{grid-column:2;margin-top:2px;font-size:14px;color:var(--soft)}
.by-agent .dot{clip-path:none;width:9px;height:9px;margin:.62em 1.5px 0;border-radius:50%;background:transparent;box-shadow:inset 0 0 0 2px var(--k)}
.note summary:hover{background:var(--fill);border-radius:20px}
.note details[open] summary:hover{border-radius:20px 20px 0 0}
.md .more{color:var(--faint)}
.rm{margin-left:auto;padding:0;border:0;background:none;color:var(--faint);font:inherit;font-size:14px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.rm:hover{color:var(--trap)}
.item.is-leaving{animation:leave .32s ease-in forwards}
@keyframes leave{to{opacity:0;transform:translateX(-24px)}}
.snack{position:fixed;left:50%;bottom:28px;z-index:4;display:flex;align-items:center;gap:16px;padding:12px 18px;border-radius:999px;max-width:calc(100% - 36px);width:max-content;background:var(--glass);color:var(--ink);backdrop-filter:blur(30px) saturate(1.5);-webkit-backdrop-filter:blur(30px) saturate(1.5);font-size:14.5px;transform:translateX(-50%);box-shadow:var(--glass-shadow),inset 0 0 0 1px var(--glass-edge)}
.snack button{flex:none;padding:0;border:0;background:none;color:inherit;font:inherit;font-weight:600;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.md{padding:4px 20px 0 43px;max-width:44em;line-height:1.85}
.md p,.md ul,.md ol,.md pre,.md blockquote{margin:0 0 .9em}
.md h4{margin:1.2em 0 .4em;font-size:16px}
.md ul,.md ol{padding-left:1.4em}
.md code{padding:1px 6px;border-radius:6px;background:var(--fill);font:.88em ui-monospace,"SF Mono",Menlo,monospace}
.md pre{padding:12px 14px;border-radius:12px;background:var(--fill);overflow-x:auto}
.md pre code{padding:0;background:none}
.md strong{font-weight:500;color:var(--k,var(--ink))}
.md blockquote{padding:10px 16px;border-left:3px solid var(--k,var(--line));border-radius:0 12px 12px 0;background:color-mix(in srgb,var(--k,transparent) 9%,transparent);color:var(--ink)}
.md blockquote>:last-child{margin-bottom:0}
.md .table{margin:0 0 .9em;overflow-x:auto}
.md table{border-collapse:collapse;font-size:14.5px;line-height:1.6}
.md th,.md td{padding:7px 14px 7px 0;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.md th{font-weight:600;color:var(--soft)}
.src{display:flex;flex-wrap:wrap;gap:6px 18px;margin:6px 0 0;padding:0 20px 18px 43px;font-size:14px;color:var(--faint)}
.md a,.src a{color:var(--k,var(--lesson));text-underline-offset:3px}
.md a:hover,.src a:hover{color:var(--ink)}
.src span{overflow-wrap:anywhere;min-width:0}
.blank,.none{margin-top:56px;color:var(--soft)}
kbd{padding:1px 7px;border-radius:6px;background:var(--fill);font:500 13px var(--sans)}
footer{margin-top:72px;font-size:14px;color:var(--faint)}
[hidden]{display:none!important}
.item.is-target{animation:target 2.4s ease-out}
@keyframes target{0%,30%{box-shadow:inset 0 0 0 1px var(--glass-edge),0 0 0 3px color-mix(in srgb,var(--k,var(--lesson)) 55%,transparent)}100%{box-shadow:inset 0 0 0 1px var(--glass-edge),0 0 0 3px transparent}}
@media (prefers-reduced-motion:reduce){.item.is-target{animation:none;box-shadow:inset 0 0 0 1px var(--glass-edge),0 0 0 3px color-mix(in srgb,var(--k,var(--lesson)) 55%,transparent)}}
::selection{background:color-mix(in srgb,var(--accent) 36%,transparent)}
:lang(zh) .md{font-size:16.5px;line-height:1.9}
@media (max-width:560px){body{padding:44px 18px 72px}h1{font-size:38px}.bar{margin:28px -18px 0;padding:12px 18px}.chart{min-height:96px;gap:2px}.col i{width:5px;height:5px}summary{padding:14px 16px}.md{padding-left:40px;padding-right:16px}.src{padding-left:40px;padding-right:16px}}
`;

const LIBRARY_JS = `
(function () {
  var q = document.getElementById("q");
  var chips = [].slice.call(document.querySelectorAll(".chip"));
  var items = [].slice.call(document.querySelectorAll(".item"));
  var days = [].slice.call(document.querySelectorAll(".day"));
  var none = document.querySelector(".none");
  var texts = items.map(function (el) { return el.textContent.toLowerCase(); });
  function apply() {
    var words = q.value.toLowerCase().split(/\\s+/).filter(Boolean);
    var kinds = chips.filter(function (c) { return c.dataset.kind && c.getAttribute("aria-pressed") === "true"; }).map(function (c) { return c.dataset.kind; });
    var mine = chips.some(function (c) { return c.dataset.by && c.getAttribute("aria-pressed") === "true"; });
    var shown = 0;
    items.forEach(function (el, i) {
      var ok = words.every(function (w) { return texts[i].indexOf(w) !== -1; }) &&
        (!kinds.length || kinds.indexOf(el.dataset.kind) !== -1) && (!mine || el.dataset.by === "you");
      el.hidden = !ok;
      if (ok) shown++;
    });
    days.forEach(function (d) { d.hidden = !d.querySelector(".item:not([hidden])"); });
    if (none) none.hidden = shown > 0 || !items.length;
  }
  q.addEventListener("input", apply);
  chips.forEach(function (c) {
    c.addEventListener("click", function () {
      c.setAttribute("aria-pressed", c.getAttribute("aria-pressed") === "true" ? "false" : "true");
      apply();
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && document.activeElement !== q) { e.preventDefault(); q.focus(); }
  });
  // Opened at an entry (library.html#n...): unfold it, bring it into view, mark it.
  function reveal() {
    var target = location.hash && document.getElementById(location.hash.slice(1));
    if (!target) return;
    var details = target.querySelector("details");
    if (details) details.open = true;
    target.classList.remove("is-target");
    void target.offsetWidth;
    target.classList.add("is-target");
    target.scrollIntoView({ block: "center" });
  }
  window.addEventListener("hashchange", reveal);
  reveal();

  // Served by dotjar (not opened as a file): things can be taken out again.
  if (location.protocol !== "http:") return;
  var snack = document.querySelector(".snack");
  var last = null;
  var timer = null;
  function call(name, arg) {
    return fetch("/api/" + name, { method: "POST", headers: { "content-type": "application/json", "x-dotjar": "1" }, body: JSON.stringify({ args: [arg] }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!d.ok) throw new Error(d.error || "failed"); return d.value; });
  }
  function settle() {
    days.forEach(function (d) { d.hidden = !d.querySelector(".item:not([hidden])"); });
  }
  function say(text, undo) {
    snack.querySelector("span").textContent = text;
    snack.querySelector("button").hidden = !undo;
    snack.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(function () { snack.hidden = true; last = null; }, 8000);
  }
  [].slice.call(document.querySelectorAll(".rm")).forEach(function (b) {
    b.hidden = false;
    b.addEventListener("click", function () {
      var item = b.closest(".item");
      b.disabled = true;
      call("removeFromLibrary", b.dataset.file).then(function (undo) {
        item.classList.add("is-leaving");
        setTimeout(function () { item.hidden = true; item.classList.remove("is-leaving"); settle(); }, 320);
        last = { undo: undo, item: item, button: b };
        say(undo.hidden ? document.body.dataset.hidden : document.body.dataset.removed, true);
      }).catch(function (err) { b.disabled = false; say(err.message, false); });
    });
  });
  snack.querySelector("button").addEventListener("click", function () {
    if (!last) return;
    var back = last;
    last = null;
    call("restoreToLibrary", back.undo).then(function () {
      back.item.hidden = false;
      back.button.disabled = false;
      settle();
      snack.hidden = true;
    }).catch(function (err) { say(err.message, false); });
  });
})();
`;

function build(cfg = config.load(), now = new Date(), language) {
  const file = libraryPath();
  const html = renderPage(collect(cfg, language), now);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, html);
  fs.renameSync(tmp, file);
  // Keep the same relative font URLs working when the page is opened as a file.
  const fontDir = path.join(path.dirname(file), "fonts");
  for (const name of ["huiwen-mincho-titles.woff", "lxgw-wenkai-regular.woff", "lxgw-wenkai-medium.woff"]) {
    try {
      const source = path.join(__dirname, "../overlay/fonts", name);
      const target = path.join(fontDir, name);
      fs.mkdirSync(fontDir, { recursive: true });
      if (!fs.existsSync(target) || !fs.readFileSync(target).equals(fs.readFileSync(source))) {
        fs.copyFileSync(source, target);
      }
    } catch {
      // Fonts are optional: a missing asset or unwritable folder uses fallbacks.
    }
  }
  return file;
}

module.exports = { libraryPath, parseFrontmatter, parseNote, collect, renderPage, build };

require("./operations").wrap(module.exports, ["build"]);
