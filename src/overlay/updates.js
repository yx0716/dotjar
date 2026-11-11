"use strict";
(function () {
  const api = window.dotjarBridge;
  if (!api || api.demo || !api.updateStatus || new URLSearchParams(location.search).has("nativeRest")) return;
  const zh = () => document.documentElement.lang.startsWith("zh");
  const say = (cn, en) => zh() ? cn : en;
  const trigger = document.createElement("button");
  trigger.className = "tool update-tool";
  trigger.type = "button";
  trigger.textContent = say("更新", "Updates");
  trigger.setAttribute("aria-haspopup", "dialog");
  document.querySelector(".tools").appendChild(trigger);
  const dialog = document.createElement("dialog");
  dialog.className = "update-dialog";
  dialog.setAttribute("aria-labelledby", "updates-heading");
  document.body.appendChild(dialog);
  let state, busy = false, error = "", timer;
  const phases = {
    downloading: ["正在下载并校验", "Downloading and verifying"],
    waiting: ["等待当前捕捞、写入和休息结束", "Waiting for work and rest to finish"],
    switching: ["正在重启并检查新版本", "Restarting and checking the new version"],
    completed: ["更新完成", "Update complete"],
    "rolling-back": ["新版本未能启动，正在恢复上一版", "Restoring the previous version"],
    "rolled-back": ["已恢复上一版本", "Previous version restored"],
    recovered: ["更新中断，已恢复上一版本", "Interrupted update recovered"],
    failed: ["更新未完成，当前版本仍可使用", "Update failed; your current version is unchanged"],
    "recovery-needed": ["恢复需要处理，请查看 update.log 并重启托管启动器", "Recovery needs attention; check update.log and restart the managed launcher"],
  };
  const active = () => state?.job && ["downloading", "waiting", "switching", "rolling-back"].includes(state.job.phase);
  function node(tag, text, cls) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (cls) element.className = cls;
    return element;
  }
  function button(text, action, disabled = false) {
    const element = node("button", text, "update-action");
    element.type = "button"; element.disabled = disabled;
    element.addEventListener("click", action); return element;
  }
  function render() {
    if (!dialog.open) return;
    dialog.replaceChildren();
    const heading = node("h2", say("关于与更新", "About & updates")); heading.id = "updates-heading";
    const close = button(say("关闭", "Close"), () => dialog.close()); close.classList.add("update-close");
    dialog.append(close, heading);
    if (!state) { dialog.append(node("p", error || say("正在读取…", "Loading…"))); return; }
    dialog.append(node("p", `dotjar ${state.current}`));
    if (state.mode !== "managed") dialog.append(node("p", say("此安装由你管理。首次迁移到托管版后，才可在这里一键升级；源码工作区不会被覆盖。", "This installation is manually managed. Migrate to a managed install to update here. Source checkouts are never overwritten."), "update-muted"), node("code", "dotjar install-managed"));
    if (!state.supported) dialog.append(node("p", say("托管更新首版支持 macOS，当前平台请手动升级。", "Managed updates currently support macOS. Update manually on this platform.")));
    if (state.available) {
      dialog.append(node("h3", say(`新版本 ${state.latest}`, `Version ${state.latest} available`)));
      if (state.notes) dialog.append(node("p", state.notes, "update-notes"));
    } else if (state.checkedAt && !state.error) dialog.append(node("p", say("当前已是最新发布版本", "You have the latest released version")));
    if (state.checkedAt) dialog.append(node("p", say("最近检查：", "Last checked: ") + new Date(state.checkedAt).toLocaleString(), "update-muted"));
    if (state.job) {
      const message = phases[state.job.phase];
      dialog.append(node("p", message ? say(...message) : state.job.phase, "update-progress"));
      if (state.job.error) dialog.append(node("p", state.job.error, "update-error"));
    }
    if (error || state.error) dialog.append(node("p", error || state.error, "update-error"));
    const controls = node("div", null, "update-actions");
    controls.append(button(busy ? say("请稍候…", "Please wait…") : say("检查更新", "Check for updates"), () => perform(() => api.updateCheck()), busy || active()));
    if (state.available && state.mode === "managed" && state.supported) controls.append(button(say("更新并重启", "Update & restart"), () => perform(() => api.updateInstall(state.latest)), busy || active()));
    if (state.available) controls.append(button(state.skipped === state.latest ? say("恢复此版本提醒", "Restore reminder") : say("跳过此版本", "Skip this version"), () => perform(() => api.updatePreferences({ skipped: state.skipped === state.latest ? null : state.latest })), busy || active()));
    if (state.job?.phase === "completed") controls.append(button(say("刷新页面", "Reload page"), () => location.reload()));
    dialog.append(controls);
    const label = node("label", null, "update-auto");
    const check = node("input"); check.type = "checkbox"; check.checked = state.autoCheck; check.disabled = busy;
    check.addEventListener("change", () => perform(() => api.updatePreferences({ autoCheck: check.checked })));
    label.append(check, document.createTextNode(say("每天检查更新（只查询版本，不自动安装）", "Check daily (never install automatically)")));
    dialog.append(label, node("p", say("检查会连接 GitHub，不发送对话和笔记。安装会等待当前工作结束，并保留你的数据。", "Checks connect to GitHub without sending conversations or notes. Installation waits for ongoing work and preserves your data."), "update-muted"));
  }
  async function refresh() {
    try {
      const next = await api.updateStatus();
      if (active() && next.job?.id === state.job.id && next.job.phase === "completed") {
        location.reload();
        return;
      }
      const changed = JSON.stringify(next) !== JSON.stringify(state);
      state = next;
      trigger.textContent = state.available && state.skipped !== state.latest ? say("有更新", "Update available") : say("更新", "Updates");
      if (changed && !busy) render();
    } catch (e) {
      if (!active()) { error = e.message; if (!busy) render(); }
    }
  }
  async function perform(action) {
    busy = true; error = ""; render();
    try { state = await action(); }
    catch (e) { error = e.message; }
    finally { busy = false; render(); }
  }
  trigger.addEventListener("click", async () => {
    dialog.showModal(); render(); await refresh(); render();
    timer = setInterval(refresh, 1000);
  });
  dialog.addEventListener("close", () => { clearInterval(timer); trigger.focus(); });
  dialog.addEventListener("keydown", (event) => event.stopPropagation());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  refresh();
  setInterval(refresh, 60000);
})();
