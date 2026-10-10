/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider spelling -> brand glyph, plus the initials fallback for a provider
 * that publishes no logo.
 *
 * A provider reaches this module as whatever string omp reported: a login
 * provider id (`google-vertex`), a models.yml slug the user typed
 * (`my-gateway`), a legacy chamber icon key (`claude`), or a display name
 * (`DeepSeek`). All four must land on the same mark, so lookup folds the input
 * to lowercase alphanumerics and matches it against this table.
 *
 * The table is DATA, not a chain of `if`s: `minimax-code-cn` is the same brand
 * as `minimax`, and a new variant belongs here as one more row rather than as
 * another branch at every call site.
 *
 * Pure and dependency-free so the server (which builds provider rows) and the
 * client (which renders them) resolve a provider identically.
 */

/**
 * Normalised provider spelling -> glyph name in `PROVIDER_GLYPHS`.
 *
 * Keys are lowercase alphanumerics only (`google-vertex` is `googlevertex`).
 * Values name an entry in the glyph table, or a brand whose mark stands for
 * several providers (Bedrock draws Amazon's mark).
 */
export const PROVIDER_GLYPH_ALIASES: Readonly<Record<string, string>> = {
  abliteration: 'abliteration',
  aiand: 'aiand',
  aimlapi: 'aimlapi',
  alibaba: 'alibaba',
  alibabacloud: 'alibaba',
  alibabacodingplan: 'alibaba',
  alibabatokenplan: 'alibaba',
  amazon: 'amazon',
  amazonbedrock: 'amazon',
  anthropic: 'anthropic',
  antigravity: 'antigravity',
  apple: 'apple',
  aws: 'amazon',
  azure: 'azure',
  azureai: 'azure',
  baidu: 'baidu',
  baseten: 'baseten',
  bedrock: 'amazon',
  bedrockmantle: 'amazon',
  cerebras: 'cerebras',
  charm: 'charm',
  charmhyper: 'charm',
  chatglm: 'zai',
  claude: 'claude',
  claudecode: 'claude',
  cline: 'cline',
  clinepass: 'cline',
  cloudflare: 'cloudflare',
  cloudflareaigateway: 'cloudflare',
  codex: 'codex',
  commandcode: 'commandcode',
  copilot: 'githubcopilot',
  coreweave: 'coreweave',
  cursor: 'cursor',
  deepinfra: 'deepinfra',
  deepseek: 'deepseek',
  devin: 'devin',
  ernie: 'baidu',
  firepass: 'fireworks',
  fireworks: 'fireworks',
  gemini: 'gemini',
  geminicli: 'geminicli',
  githubcopilot: 'githubcopilot',
  gitlab: 'gitlab',
  gitlabduo: 'gitlab',
  gitlabduoagent: 'gitlab',
  glm: 'zai',
  gmicloud: 'gmicloud',
  google: 'google',
  googleantigravity: 'antigravity',
  googlecloud: 'google',
  googlegemini: 'gemini',
  googlegeminicli: 'geminicli',
  googlevertex: 'vertexai',
  grok: 'xai',
  groq: 'groq',
  huggingface: 'huggingface',
  kenari: 'kenari',
  kilo: 'kilocode',
  kilocode: 'kilocode',
  kimi: 'kimi',
  kimicode: 'kimi',
  litellm: 'litellm',
  llama: 'meta',
  llamacpp: 'llamacpp',
  lmstudio: 'lmstudio',
  meta: 'meta',
  metaai: 'metaai',
  microsoftazure: 'azure',
  minimax: 'minimax',
  minimaxcode: 'minimax',
  minimaxcodecn: 'minimax',
  mistral: 'mistral',
  mistralai: 'mistral',
  moonshot: 'moonshot',
  moonshotai: 'moonshot',
  musecode: 'metaai',
  nanogpt: 'nanogpt',
  novita: 'novita',
  nvidia: 'nvidia',
  ollama: 'ollama',
  ollamacloud: 'ollama',
  openai: 'openai',
  openaicodex: 'codex',
  opencode: 'opencode',
  opencodego: 'opencode',
  opencodezen: 'opencode',
  openrouter: 'openrouter',
  qianfan: 'baidu',
  qwen: 'qwen',
  qwenportal: 'qwen',
  sakana: 'sakana',
  sakanaai: 'sakana',
  siliconcloud: 'siliconcloud',
  siliconflow: 'siliconcloud',
  siliconflowcn: 'siliconcloud',
  singularity: 'singularity',
  singularityapidev: 'singularity',
  singularityapitech: 'singularity',
  stepfun: 'stepfun',
  synthetic: 'synthetic',
  together: 'together',
  togetherai: 'together',
  venice: 'venice',
  vercel: 'vercel',
  vercelaigateway: 'vercel',
  vertexai: 'vertexai',
  vllm: 'vllm',
  wafer: 'wafer',
  waferserverless: 'wafer',
  xai: 'xai',
  xaioauth: 'xai',
  xiaomi: 'xiaomi',
  xiaomitokenplanams: 'xiaomi',
  xiaomitokenplancn: 'xiaomi',
  xiaomitokenplansgp: 'xiaomi',
  yolo: 'yoloauto',
  yoloauto: 'yoloauto',
  zai: 'zai',
  zaicodingplan: 'zai',
  openaicodexdevice: 'codex',
  perplexity: 'perplexity',
  tavily: 'tavily',
  kagi: 'kagi',
  exa: 'exa',
  stencil: 'stencil',
  zenmux: 'zenmux',
  zhipu: 'zhipu',
  zhipucodingplan: 'zhipu',
};

/**
 * The one fold every provider match uses: lowercase alphanumerics only, so
 * `google-vertex`, `Google Vertex` and `google_vertex` are the same key.
 *
 * Exported because the plugin registry (`providerIcon`) matches a provider with
 * this SAME rule — a registered mark has to be found by every spelling the
 * built-in table accepts, or a plugin's mark would appear only for the exact
 * string its author happened to type.
 */
export function foldProviderKey(candidate: string): string {
  return candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The glyph name for a provider, or `null` when no brand mark is registered —
 * the caller then draws the initials badge instead of an empty box.
 *
 * Candidates are tried in order and each is folded to lowercase alphanumerics
 * first, so a stored legacy icon key (`claude`) still resolves after the
 * provider's slug changes. Pass the provider's own `icon` field before its slug
 * to keep that precedence.
 */
export function resolveProviderGlyph(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = foldProviderKey(candidate);
    const alias = key ? PROVIDER_GLYPH_ALIASES[key] : undefined;
    if (alias) return alias;
  }
  return null;
}

/**
 * Fallback badge text for a provider with no brand mark: the initial of each of
 * the label's first two title-cased words, joined and closed with a single dot —
 * `Tooker` -> `t.`, `Toktok ID` -> `ti.`.
 *
 * Lowercase because the badge renders beside lowercase UI labels, and capped at
 * two initials because a third overflows the badge at icon size.
 */
export function providerInitials(label: string): string {
  const words = label.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return '?';
  const initials = words
    .slice(0, 2)
    .map((word) => word.charAt(0).toLowerCase())
    .join('');
  return `${initials}.`;
}
