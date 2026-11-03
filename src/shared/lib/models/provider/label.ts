/**
 * Pure provider-slug → display-label helpers (theme-independent, no React).
 */

/** Shape of the per-provider info carried by `ModelsData.connectedProviders`. */
export type ProviderNameInfo = { id: string; name: string; disabled: boolean };

/**
 * Title-case a provider slug like `kenari` → `Kenari`, `command-code` →
 * `Command Code`, `openai_codex` → `Openai Codex`. Empty slugs return an empty
 * label so callers can omit the provider metadata item.
 */
export function titleCaseProviderSlug(slug: string): string {
  if (!slug.trim()) return '';
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Resolve a provider slug to a human label: prefer the connected-provider
 * display name when the slug matches one, otherwise title-case the slug.
 */
export function providerLabel(slug: string, names: Record<string, string> = {}): string {
  if (!slug.trim()) return '';
  const known = names[slug];
  return known?.trim() ? known : titleCaseProviderSlug(slug);
}

/**
 * Slug aliases omp uses interchangeably, folded onto one identity.
 *
 * Both the quota surfaces (`usage/providers.server.ts`) and the token/cost
 * rollup attribute rows by provider, and the two must agree or the same
 * account is two rows on one panel and one on the other.
 */
const SLUG_ALIASES: Record<string, string> = {
  'command-code': 'commandcode',
};

/** The canonical spelling of a provider slug: lowercased, alias folded. */
export function canonicalProviderSlug(slug: string): string {
  const lower = slug.trim().toLowerCase();
  return SLUG_ALIASES[lower] ?? lower;
}

/**
 * Brand spellings a title-case pass cannot produce. Kept small on purpose: the
 * slug is the identity, this is only how it is printed.
 */
const BRAND_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  kenari: 'Kenari.id',
  deepseek: 'DeepSeek',
  'openai-codex': 'OpenAI Codex',
  'google-gemini-cli': 'Google Gemini CLI',
  'google-antigravity': 'Google Antigravity',
  'github-copilot': 'GitHub Copilot',
  zai: 'Z.AI',
  'zai-coding-plan': 'Z.AI Coding Plan',
  xai: 'xAI',
  'xai-oauth': 'xAI (OAuth)',
  'kimi-code': 'Kimi Code',
  'qwen-portal': 'Qwen Portal',
  'minimax-code': 'MiniMax Code',
  'minimax-code-cn': 'MiniMax Code (CN)',
  'alibaba-token-plan': 'Alibaba Token Plan',
  'alibaba-coding-plan': 'Alibaba Coding Plan',
  'zhipu-coding-plan': 'Zhipu Coding Plan',
  'gitlab-duo': 'GitLab Duo',
  'gitlab-duo-agent': 'GitLab Duo Agent',
  'charm-hyper': 'Charm Hyper',
  'cline-pass': 'Cline Pass',
  'opencode-go': 'OpenCode Go',
  'xiaomi-token-plan-sgp': 'Xiaomi Token Plan (SGP)',
  'xiaomi-token-plan-ams': 'Xiaomi Token Plan (AMS)',
  'xiaomi-token-plan-cn': 'Xiaomi Token Plan (CN)',
  'openai-codex-device': 'OpenAI Codex (Device)',
};

/** Human-readable provider name: brand spelling when known, title case otherwise. */
export function providerDisplayName(slug: string): string {
  const canonical = canonicalProviderSlug(slug);
  return BRAND_NAMES[canonical] ?? titleCaseProviderSlug(canonical);
}

/** Build a slug → display-name map from `/api/models` `connectedProviders`. */
export function providerNamesFromConnected(
  connectedProviders: readonly ProviderNameInfo[] | undefined,
): Record<string, string> {
  if (!connectedProviders?.length) return {};
  return Object.fromEntries(
    connectedProviders.filter((p) => p.name?.trim()).map((p): [string, string] => [p.id, p.name]),
  );
}
