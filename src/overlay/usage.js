"use strict";
(function (root) {
  const say = (zh, cn, en) => zh ? cn : en;
  function consumption(record, zh = true) {
    const u = record?.usage;
    let value;
    if (u?.estimatedUsd != null) value = say(zh, `参考费用约 $${u.estimatedUsd.toFixed(4)}`, `Estimated cost $${u.estimatedUsd.toFixed(4)}`);
    else if (u?.total != null) value = `${u.total.toLocaleString(zh ? "zh-CN" : "en-US")} tokens`;
    else return say(zh, "消耗暂不可获取", "Usage unavailable");
    return value + (record.usageComplete === false ? say(zh, "（统计不完整）", " (partial)") : "");
  }
  const names = {
    running: ["进行中", "Running"], succeeded: ["完成", "Completed"],
    failed: ["失败", "Failed"], cancelled: ["已取消", "Cancelled"], interrupted: ["已中断", "Interrupted"],
  };
  function label(record, zh = true) {
    if (!record) return say(zh, "捕捞记录与消耗", "Runs & usage");
    const status = names[record.status] || names.interrupted;
    return say(zh, "最近一次：", "Last run: ") + (record.status === "succeeded" ? "" : say(zh, ...status) + " · ") + consumption(record, zh);
  }
  function open(api, day, zh = true) {
    const text = (cn, en) => say(zh, cn, en);
    const focus = document.activeElement;
    const node = (tag, value, cls) => {
      const n = document.createElement(tag);
      if (value != null) n.textContent = value;
      if (cls) n.className = cls;
      return n;
    };
    const dialog = node("dialog", null, "update-dialog usage-dialog");
    dialog.setAttribute("aria-label", text("捕捞记录与消耗", "Runs & usage"));
    const heading = node("h2", text("捕捞记录与消耗", "Runs & usage"));
    const close = node("button", text("关闭", "Close"), "update-action update-close"); close.type = "button";
    close.addEventListener("click", () => dialog.close());
    const content = node("div");
    const refresh = node("button", text("刷新", "Refresh"), "update-action"); refresh.type = "button";
    dialog.append(close, heading, node("p", text(`整理日期：${day}`, `Material date: ${day}`)),
      node("p", text("只记录 dotjar 发起的捕捞。参考费用不代表订阅额外扣费，也不能换算为套餐已用比例。", "Only dotjar runs are recorded. Estimated cost is not an extra subscription charge or a share of your plan."), "update-muted"), content, refresh);
    async function load() {
      refresh.disabled = true;
      try {
        const data = await api.usage(day);
        content.replaceChildren();
        if (!data.records.length) content.append(node("p", text("暂无记录。从支持统计的版本开始记录，之前的捕捞不会补算。", "No records yet. Runs before this feature are not reconstructed.")));
        if (data.total > data.records.length) content.append(node("p", text(`显示最近 ${data.records.length} 次，共 ${data.total} 次。`, `Showing the latest ${data.records.length} of ${data.total} runs.`)));
        if (data.unreadable) content.append(node("p", text("部分记录无法读取，列表可能不完整。", "Some records could not be read; this list may be incomplete."), "update-error"));
        for (const r of data.records) {
          const row = node("article", null, "usage-run");
          const state = names[r.status] || names.interrupted;
          const date = new Date(r.startedAt).toLocaleString(zh ? "zh-CN" : "en-US");
          row.append(node("h3", `${date} · ${text(...state)}`), node("p", `${r.model || r.engine} · ${consumption(r, zh)}`));
          const details = [];
          if (r.endedAt) details.push(text(`耗时 ${Math.max(0, Math.round((r.endedAt - r.startedAt) / 1000))} 秒`, `${Math.max(0, Math.round((r.endedAt - r.startedAt) / 1000))}s`));
          if (r.status === "succeeded" && r.found != null) details.push(text(`新增 ${r.found} 颗星`, `${r.found} new stars`));
          const u = r.usage;
          for (const [key, cn, en] of [["input", "输入", "Input"], ["output", "输出", "Output"], ["cached", "其中缓存读取", "Cached input subset"], ["written", "其中缓存写入", "Cache write subset"], ["reasoning", "其中推理", "Reasoning output subset"]]) {
            if (u?.[key] != null) details.push(`${text(cn, en)} ${u[key].toLocaleString()}`);
          }
          if (u?.total == null || r.usageComplete === false || ["running", "interrupted"].includes(r.status)) details.push(text("用量统计不完整", "Usage accounting incomplete"));
          row.append(node("p", details.join(" · "), "update-muted"));
          content.append(row);
        }
      } catch (e) { content.replaceChildren(node("p", e.message, "update-error")); }
      finally { refresh.disabled = false; }
    }
    refresh.addEventListener("click", load);
    dialog.addEventListener("keydown", (event) => event.stopPropagation());
    dialog.addEventListener("close", () => { dialog.remove(); if (focus?.isConnected) focus.focus(); });
    document.body.append(dialog); dialog.showModal(); load();
  }
  const api = { consumption, label, open };
  if (typeof module === "object") module.exports = api;
  else root.DotjarUsage = api;
})(typeof window === "object" ? window : globalThis);
