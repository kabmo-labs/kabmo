/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The provider ids the VENDOR ships, as opposed to the ones a user registered.
 *
 * This is the one fact the provider-import surfaces turn on: copying `anthropic`
 * out of omp into codex would write an override of the target's own built-in
 * provider instead of adding a gateway, and offering it as an import row
 * promises an action that either collides or does nothing. `customProvidersOnly`
 * filters with this list.
 *
 * The census is omp 18.3.0's `KnownProvider` set plus the ids the other agents
 * vendor themselves — measured, and pinned by `glyph.test.ts`, which walks every
 * id here and fails if a provider would draw neither a mark nor initials. A
 * provider added upstream is one row here, not a new branch at a call site.
 *
 * Deliberately NOT here: user-registered slugs (`kenari`, `agentrouter`,
 * `custom`), which are the rows an import is FOR.
 */
export const VENDOR_PROVIDER_IDS: readonly string[] = [
  'abliteration', 'aiand', 'aimlapi', 'alibaba-coding-plan', 'alibaba-token-plan', 'amazon-bedrock',
  'anthropic', 'apple', 'azure', 'baseten', 'bedrock-mantle', 'cerebras', 'charm-hyper', 'cline-pass',
  'cloudflare-ai-gateway', 'commandcode', 'coreweave', 'cursor', 'deepinfra', 'deepseek', 'devin',
  'firepass', 'fireworks', 'github-copilot', 'gitlab-duo', 'gitlab-duo-agent', 'gmi-cloud', 'google',
  'google-antigravity', 'google-gemini-cli', 'google-vertex', 'groq', 'huggingface', 'kilo',
  'kimi-code', 'litellm', 'llama.cpp', 'lm-studio', 'local', 'meta', 'minimax', 'minimax-code',
  'minimax-code-cn', 'mistral', 'moonshot', 'muse-code', 'nanogpt', 'novita', 'nvidia', 'ollama',
  'ollama-cloud', 'openai', 'openai-codex', 'openai-codex-device', 'opencode-go', 'opencode-zen',
  'openrouter', 'qianfan', 'qwen-portal', 'sakana', 'siliconflow', 'siliconflow-cn',
  'singularityapi-dev', 'singularityapi-tech', 'stepfun', 'synthetic', 'together', 'typesafe',
  'umans', 'venice', 'vercel-ai-gateway', 'vllm', 'wafer-serverless', 'xai', 'xai-oauth', 'xiaomi',
  'xiaomi-token-plan-ams', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp', 'yolo-auto', 'zai',
  'zhipu-coding-plan', 'zhipu', 'zenmux', 'qwen-oauth', 'ollama-chat',
];

const VENDOR_SET: ReadonlySet<string> = new Set(VENDOR_PROVIDER_IDS.map(fold));

/** Fold a provider id to the shape the census compares (`Llama.CPP` = `llamacpp`). */
function fold(id: string): string {
  return id.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * True when the id names a provider the vendor ships, or one this registry
 * declares as its own (`extra`).
 *
 * A registry's own list wins where it is authoritative (codex reserves
 * `openai`/`ollama`/`lmstudio`, qwen cannot override `qwen-oauth`), because a
 * registry may ship a provider the shared census has never heard of.
 */
export function isVendorProviderId(id: string, extra?: readonly string[]): boolean {
  const key = fold(id);
  if (!key) return true;
  if (extra?.some((entry) => fold(entry) === key)) return true;
  return VENDOR_SET.has(key);
}

/**
 * The CUSTOM rows of a provider list — the only ones an import may offer.
 *
 * Kept as a predicate over ids so a reader can apply it to a map's keys before
 * it has built entries, and a test can assert the rule without a registry file.
 */
export function customProviderIds(
  ids: readonly string[],
  extra?: readonly string[],
): string[] {
  return ids.filter((id) => !isVendorProviderId(id, extra));
}
