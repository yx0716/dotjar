"use strict";

// A small Markdown renderer for drafts. Everything is escaped first, so text
// that came out of a transcript or a model can never become markup.

(function (root) {
  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function inline(text) {
    return escapeHtml(text)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, alias) => `<span class="wikilink">${alias || target}</span>`)
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  }

  function render(markdown) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let para = [];
    let list = null; // { tag, items }
    let fence = null;

    const flushPara = () => {
      if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
      para = [];
    };
    const flushList = () => {
      if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
      list = null;
    };

    // A table row: "| a | b |", the outer pipes optional.
    const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    const isRule = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line || "");

    for (let n = 0; n < lines.length; n++) {
      const raw = lines[n];
      if (fence !== null) {
        if (/^\s*```/.test(raw)) {
          out.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
          fence = null;
        } else {
          fence.push(raw);
        }
        continue;
      }
      if (/^\s*```/.test(raw)) {
        flushPara();
        flushList();
        fence = [];
        continue;
      }
      const line = raw.trim();
      if (!line) {
        flushPara();
        flushList();
        continue;
      }
      if (line.includes("|") && isRule(lines[n + 1])) {
        flushPara();
        flushList();
        const head = cells(line);
        const rows = [];
        n += 2;
        while (n < lines.length && lines[n].trim().includes("|")) rows.push(cells(lines[n++]));
        n--;
        const row = (r, tag) => `<tr>${head.map((_, i) => `<${tag}>${inline(r[i] || "")}</${tag}>`).join("")}</tr>`;
        out.push(`<div class="table"><table><thead>${row(head, "th")}</thead><tbody>${rows.map((r) => row(r, "td")).join("")}</tbody></table></div>`);
        continue;
      }
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        flushPara();
        flushList();
        out.push(`<h4>${inline(heading[2])}</h4>`);
        continue;
      }
      const ordered = /^\d+[.)、]\s+(.*)$/.exec(line);
      const bullet = /^[-*•]\s+(.*)$/.exec(line);
      if (ordered || bullet) {
        flushPara();
        const tag = ordered ? "ol" : "ul";
        if (list && list.tag !== tag) flushList();
        if (!list) list = { tag, items: [] };
        list.items.push((ordered || bullet)[1]);
        continue;
      }
      if (line.startsWith(">")) {
        flushPara();
        flushList();
        out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
        continue;
      }
      // An indented line under a list item continues that item.
      if (list && /^\s{2,}\S/.test(raw)) {
        list.items[list.items.length - 1] += " " + line;
        continue;
      }
      flushList();
      para.push(line);
    }
    if (fence !== null) out.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
    flushPara();
    flushList();
    return out.join("\n");
  }

  // A short, stable id for a file, so the library page can be opened at the
  // entry for it. The same function runs in the page and in Node.
  function anchorFor(filePath) {
    let h = 0x811c9dc5;
    for (const ch of String(filePath)) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `n${h.toString(36)}`;
  }

  const api = { render, escapeHtml, anchorFor };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DotjarMarkdown = api;
})(typeof window !== "undefined" ? window : globalThis);
