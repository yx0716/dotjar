"use strict";

(function (root) {
  function entries(growth) {
    if (!growth) return [];
    const rows = [];
    if (growth.highlight) rows.push({ kind: "good", text: growth.highlight });
    (growth.applied || []).forEach((a, n) => rows.push({ kind: "applied", title: a.title, text: a.how || "", n }));
    if (growth.next) rows.push({ kind: "next", text: growth.next });
    // Content, not list position: changed feedback should appear again.
    return rows.map((row) => ({ ...row, key: JSON.stringify([row.kind, row.title || "", row.text]) }));
  }

  function createStore(getStorage, name = "dotjar.growth.read.v1") {
    let memory = {};
    let unavailable = false;
    function read() {
      if (unavailable) return memory;
      let raw;
      try { raw = getStorage().getItem(name); }
      catch { unavailable = true; return memory; }
      try {
        const value = JSON.parse(raw || "{}");
        memory = value && typeof value === "object" && !Array.isArray(value) ? value : {};
      } catch { memory = {}; }
      return memory;
    }
    return {
      has(day, key) { return Array.isArray(read()[day]) && memory[day].includes(key); },
      set(day, key, seen) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
        const data = read();
        const keys = new Set(Array.isArray(data[day]) ? data[day] : []);
        if (seen) keys.add(key); else keys.delete(key);
        data[day] = [...keys];
        // Bound local presentation state. This never changes the day's ledger.
        const days = Object.keys(data).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse().slice(0, 30);
        memory = Object.fromEntries(days.map((d) => [d, data[d]]));
        if (unavailable) return false;
        try { getStorage().setItem(name, JSON.stringify(memory)); return true; }
        catch { unavailable = true; return false; }
      },
    };
  }

  const api = { entries, createStore };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DotjarGrowth = api;
})(typeof window !== "undefined" ? window : globalThis);
