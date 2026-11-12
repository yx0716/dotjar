"use strict";
const { normalize } = require("./usage");

async function readChatStream(response, { model, onText, onUsage }) {
  let buffer = "", text = "", usage = null, complete = false;
  const decoder = new TextDecoder();
  function event(frame) {
    const data = frame.split("\n").filter((s) => s.startsWith("data:")).map((s) => s.slice(5).trimStart()).join("\n");
    if (!data) return;
    if (data === "[DONE]") { complete = true; return; }
    const chunk = JSON.parse(data);
    if (chunk.error) throw new Error(chunk.error.message || "模型流式返回失败");
    if (chunk.model) model = chunk.model;
    if (chunk.usage) { usage = normalize("openai", chunk.usage); onUsage?.(usage); }
    const choice = chunk.choices?.find((c) => c.index === 0) || chunk.choices?.[0];
    if (typeof choice?.delta?.content === "string") {
      text += choice.delta.content;
      if (text.length > 2 * 1024 * 1024) throw new Error("模型返回的内容过长");
      onText?.(text);
    }
    if (choice?.finish_reason === "length" || choice?.finish_reason === "content_filter") throw new Error("模型输出未完整结束");
    if (choice?.finish_reason === "stop") complete = true;
  }
  try {
    for await (const chunk of response.body) {
      buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      if (buffer.length > 4 * 1024 * 1024) throw new Error("模型事件过长");
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) { const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2); event(frame); }
    }
    buffer += decoder.decode();
    if (buffer.trim()) event(buffer);
    if (!complete || !text.trim()) throw new Error("模型连接在返回完整结果前断开");
    return { text, usage, model, costUsd: null };
  } catch (error) { error.usage = usage; throw error; }
}
module.exports = { readChatStream };
