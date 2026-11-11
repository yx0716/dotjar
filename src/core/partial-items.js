"use strict";

// Read only complete values from a still-arriving JSON object. Braces inside
// strings (including Markdown/code) are not structure. No incomplete draft is
// repaired or invented. The final reply still goes through the normal parser.
function stringEnd(text, start) {
  let escaped = false;
  for (let i = start + 1; i < text.length; i++) {
    if (escaped) escaped = false;
    else if (text[i] === "\\") escaped = true;
    else if (text[i] === '"') return i + 1;
  }
  return -1;
}
function valueEnd(text, start) {
  if (text[start] === '"') return stringEnd(text, start);
  if (!"[{".includes(text[start])) {
    const end = text.slice(start).search(/[,}\]]/);
    return end < 0 ? -1 : start + end;
  }
  const stack = [];
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { const end = stringEnd(text, i); if (end < 0) return -1; i = end - 1; }
    else if (ch === "[" || ch === "{") stack.push(ch);
    else if (ch === "]" || ch === "}") {
      if (stack.pop() !== (ch === "]" ? "[" : "{")) return -1;
      if (!stack.length) return i + 1;
    }
  }
  return -1;
}
function partialItems(text) {
  if (typeof text !== "string" || text.length > 2 * 1024 * 1024) return [];
  let i = text.indexOf("{");
  if (i < 0) return [];
  i++;
  const ws = () => { while (/\s/.test(text[i] || "") && i < text.length) i++; };
  while (i < text.length) {
    ws(); if (text[i] !== '"') return [];
    const end = stringEnd(text, i); if (end < 0) return [];
    let key;
    try { key = JSON.parse(text.slice(i, end)); } catch { return []; }
    i = end; ws(); if (text[i++] !== ":") return []; ws();
    if (key === "items") {
      if (text[i++] !== "[") return [];
      const items = [];
      while (i < text.length) {
        ws(); if (text[i] === "]") return items;
        const stop = valueEnd(text, i); if (stop < 0) return items;
        try { items.push(JSON.parse(text.slice(i, stop))); } catch { return items; }
        i = stop; ws();
        if (text[i] === "]") return items;
        if (text[i++] !== ",") return items;
      }
      return items;
    }
    const stop = valueEnd(text, i); if (stop < 0) return [];
    i = stop; ws(); if (text[i++] !== ",") return [];
  }
  return [];
}
module.exports = { partialItems };
