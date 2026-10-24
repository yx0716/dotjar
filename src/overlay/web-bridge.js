"use strict";

// When the page is served by the local web server (`dotjar web`), this is
// what answers it: the same calls the desktop shell's preload provides, sent
// over HTTP. In the desktop app, or opened as a plain file, it does nothing.

(function () {
  if (window.dotjarBridge || !/^https?:$/.test(location.protocol)) return;

  // The page sets its language on <html>; these few messages follow it.
  const say = (zh, en) => (document.documentElement.lang === "en" ? en : zh);

  async function call(name, ...args) {
    const res = await fetch(`/api/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-dotjar": "1" },
      body: JSON.stringify({ args }),
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(
        res.status === 403
          ? say("这个页面的授权失效了，在终端重新跑一下 npm run web", "This page is no longer authorized. Run npm run web again in a terminal.")
          : say(`本机的 dotjar 服务没回应（${res.status}）`, `The local dotjar server did not answer (${res.status}).`)
      );
    }
    if (data.ok) return data.value;
    const err = new Error(data.error || "出错了");
    err.code = data.code;
    throw err;
  }

  window.dotjarBridge = {
    demo: false,
    web: true,
    meta: () => call("meta"),
    today: (daysBack) => call("today", daysBack),
    distill: (days) => call("distill", days),
    calendar: (month) => call("calendar", month),
    distilling: () => call("distilling"),
    setEngine: (id) => call("setEngine", id),
    restart: () => call("restart"),
    keep: (id) => call("keep", id),
    skip: (id) => call("skip", id),
    reopen: (id) => call("reopen", id),
    copy: (text) => navigator.clipboard.writeText(text),
    // The browser owns the clipboard here, so the page reads it and hands the text over.
    paste: async () => {
      let text = "";
      try {
        text = await navigator.clipboard.readText();
      } catch {
        throw new Error(say("浏览器没允许读剪贴板", "The browser did not allow reading the clipboard."));
      }
      if (!text.trim()) throw new Error(say("剪贴板里没有文字", "The clipboard has no text."));
      return call("capture", text);
    },
    chooseDepositDir: async (current) => {
      const dir = window.prompt(say("笔记存到哪个文件夹？填完整路径", "Folder for kept notes (full path)"), current || "");
      return dir && dir.trim() ? call("setDepositDir", dir) : call("today");
    },
    reveal: (file) => call("reveal", file),
    library: async (anchor) => {
      window.open(`/library${anchor ? `#${encodeURIComponent(anchor)}` : ""}`, "_blank", "noopener");
      return true;
    },
    hide: async () => true,
    // A tab has no "shown" event from a shell; coming back to it is the cue.
    onShown: (fn) =>
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) fn();
      }),
    onCaptured: () => {},
  };
})();
