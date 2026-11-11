"use strict";

// Counts are provider-reported. Cached/reasoning counts are subsets, never
// added twice. Unknown is null, not zero. Only allowlisted numeric fields persist.
const number = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const count = (v) => Number.isSafeInteger(v) && v >= 0 ? v : null;
function normalize(engine, raw, costUsd) {
  const u = raw && typeof raw === "object" ? raw : {};
  let input, output, cached, written = null, reasoning;
  if (engine === "claude-cli") {
    cached = count(u.cache_read_input_tokens);
    written = count(u.cache_creation_input_tokens);
    const uncached = count(u.input_tokens);
    input = [uncached, cached, written].every((v) => v !== null) ? uncached + cached + written : null;
    output = count(u.output_tokens);
    reasoning = null;
  } else if (engine === "codex-cli") {
    input = count(u.input_tokens); output = count(u.output_tokens);
    cached = count(u.cached_input_tokens); reasoning = count(u.reasoning_output_tokens);
  } else {
    input = count(u.prompt_tokens); output = count(u.completion_tokens);
    cached = count(u.prompt_tokens_details?.cached_tokens);
    reasoning = count(u.completion_tokens_details?.reasoning_tokens);
  }
  if (input !== null && cached > input) cached = null;
  if (output !== null && reasoning > output) reasoning = null;
  const total = input !== null && output !== null ? count(input + output) : null;
  return { source: engine, input, output, cached, written, reasoning, total,
    estimatedUsd: engine === "claude-cli" ? number(costUsd) : null };
}
module.exports = { normalize };
