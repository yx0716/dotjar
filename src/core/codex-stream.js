"use strict";
const fs = require("fs");
const { spawn } = require("child_process");
const { normalize } = require("./usage");

// A private stdio app-server connection, ephemeral thread, one turn. Failure
// before turn/start permits the old exec path; after sending it NEVER retry
// automatically, even if the reply is lost (it could already be chargeable).
function runCodexStream({ codexPath, model, effort = "low", prompt, cwd, timeoutMs = 300000, signal, env, onText, onUsage }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("已取消"));
    const startedAt = Date.now();
    let child, timer, setupTimer, done = false, started = false, threadId, turnId;
    let line = "", text = "", measured = null, actualModel = model || "codex";
    const messages = new Map();
    function finish(error) {
      if (done) return; done = true;
      clearTimeout(timer); clearTimeout(setupTimer);
      signal?.removeEventListener("abort", abort);
      child?.stdin.end();
      child?.kill("SIGTERM");
      if (error) {
        if (!started && !signal?.aborted) error.code = "NO_STREAM";
        error.usage = measured;
        reject(error);
      } else resolve({ text, usage: measured, costUsd: null, model: actualModel, durationMs: Date.now() - startedAt });
    }
    const abort = () => finish(new Error("已取消"));
    function send(message) { if (!done) child.stdin.write(JSON.stringify(message) + "\n"); }
    function read(message) {
      if (done) return;
      const p = message.params || {};
      // Never grant a tool/permission request made by this analysis turn.
      if (message.method && message.id != null) {
        send({ id: message.id, error: { code: -32601, message: "This analysis client does not support tool or approval requests" } });
        return;
      }
      if (message.error && message.id != null) return finish(new Error(`Codex: ${message.error.message || "请求失败"}`));
      if (message.id === 1 && message.result) {
        send({ method: "initialized", params: {} });
        send({ id: 2, method: "thread/start", params: {
          ...(model ? { model } : {}), cwd, ephemeral: true, approvalPolicy: "never", sandbox: "read-only",
          developerInstructions: "Analyze only the material in the user message. Do not use tools. Reply with the requested JSON only.",
          config: { web_search: "disabled", model_reasoning_effort: effort },
        } });
      } else if (message.id === 2 && message.result) {
        threadId = message.result.thread?.id;
        if (!threadId || message.result.thread.ephemeral !== true) return finish(new Error("Codex 不支持临时流式会话"));
        actualModel = message.result.model || actualModel;
        clearTimeout(setupTimer);
        started = true; // before writing; ambiguity must not cause a second call
        send({ id: 3, method: "turn/start", params: { threadId, input: [{ type: "text", text: prompt }], effort, approvalPolicy: "never" } });
      } else if (message.id === 3 && message.result) {
        turnId = message.result.turn?.id;
      } else if (p.threadId === threadId && (!turnId || !p.turnId || p.turnId === turnId)) {
        if (message.method === "item/agentMessage/delta" && typeof p.delta === "string") {
          text = (messages.get(p.itemId) || "") + p.delta;
          if (text.length > 2 * 1024 * 1024) return finish(new Error("模型返回的内容过长"));
          messages.set(p.itemId, text);
          onText?.(text);
        } else if (message.method === "item/completed" && p.item?.type === "agentMessage") {
          text = String(p.item.text || ""); onText?.(text);
        } else if (message.method === "thread/tokenUsage/updated") {
          const u = p.tokenUsage?.total;
          if (u) {
            measured = normalize("codex-cli", { input_tokens: u.inputTokens, cached_input_tokens: u.cachedInputTokens, output_tokens: u.outputTokens, reasoning_output_tokens: u.reasoningOutputTokens });
            onUsage?.(measured);
          }
        } else if (message.method === "turn/completed") {
          if (p.turn?.status !== "completed") return finish(new Error(p.turn?.error?.message || "Codex 本轮未完成"));
          if (!text.trim()) return finish(new Error("Codex 没有返回内容"));
          finish();
        }
      }
    }
    try {
      fs.mkdirSync(cwd, { recursive: true });
      child = spawn(codexPath, ["app-server"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
      timer = setTimeout(() => finish(new Error(`codex 超过 ${Math.round(timeoutMs / 1000)} 秒没有完成`)), timeoutMs);
      setupTimer = setTimeout(() => finish(new Error("Codex 流式连接未能建立")), Math.min(15000, timeoutMs));
      signal?.addEventListener("abort", abort, { once: true });
      child.stdin.on("error", (error) => finish(error));
      child.stderr.on("data", () => {});
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        if (done) return;
        line += chunk;
        if (line.length > 4 * 1024 * 1024) return finish(new Error("Codex 事件过长"));
        let split;
        while (!done && (split = line.indexOf("\n")) >= 0) {
          const value = line.slice(0, split); line = line.slice(split + 1);
          let event;
          try { event = JSON.parse(value); } catch { continue; }
          try { read(event); } catch (error) { finish(error); }
        }
      });
      child.on("error", (error) => finish(error));
      child.on("close", () => { if (!done) finish(new Error("Codex 流式连接已断开")); });
      send({ id: 1, method: "initialize", params: { clientInfo: { name: "dotjar", version: require("../../package.json").version } } });
    } catch (error) { finish(error); }
  });
}
module.exports = { runCodexStream };
