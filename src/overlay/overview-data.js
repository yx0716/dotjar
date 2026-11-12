"use strict";

(function (root) {
  function belongs(dot, tasks) {
    return Number.isInteger(dot.task) && dot.task >= 0 && dot.task < tasks.length;
  }

  // Keep source indices for details, but give the renderer local indices.
  // Every task and every dot belongs to exactly one page, including loose stars.
  function page(tasks, dots, requested = 0, size = 6) {
    const time = (value) => {
      if (!value) return Infinity;
      const [h, m] = value.split(":").map(Number);
      return (h < 4 ? h + 24 : h) * 60 + m;
    };
    const groups = tasks.map((task, index) => ({ task, index }));
    groups.sort((a, b) => time(a.task.from) - time(b.task.from));
    if (dots.some((d) => !belongs(d, tasks))) groups.push({ index: -1 });
    const pages = Math.max(1, Math.ceil(groups.length / size));
    const current = Math.min(pages - 1, Math.max(0, requested));
    const selected = groups.slice(current * size, (current + 1) * size);
    const indices = selected.filter((g) => g.task).map((g) => g.index);
    const loose = selected.some((g) => g.index === -1);
    return {
      current, pages, total: groups.length,
      tasks: indices.map((i) => ({ ...tasks[i], overviewIndex: i })),
      dots: dots.filter((d) => belongs(d, tasks) ? indices.includes(d.task) : loose)
        .map((d) => ({ ...d, task: belongs(d, tasks) ? indices.indexOf(d.task) : -1 })),
    };
  }

  function feedback(rows, isRead, expanded) {
    const unread = rows.map((r, i) => i).filter((i) => !isRead(rows[i]));
    const priority = unread.filter((i) => rows[i].kind !== "applied");
    const visible = new Set(expanded ? unread : [...priority, ...unread.filter((i) => !priority.includes(i))].slice(0, 2));
    return { visible, hidden: unread.length - visible.size };
  }

  const api = { page, belongs, feedback };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DotjarOverview = api;
})(typeof window !== "undefined" ? window : globalThis);
