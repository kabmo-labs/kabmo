/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Builds the `providers` list of `GET /api/settings/usage`.
 *
 * Three inputs are folded per provider:
 *  1. credentials — a provider with no usable key is dropped entirely, never
 *     rendered as an empty "not configured" row;
 *  2. provider-reported quota windows (`omp usage --json`), which omp already
 *     normalizes per vendor;
 *  3. the token/cost burn omp recorded locally in its session transcripts
 *     (trailing 30 days), attributed by the `message.provider` omp wrote.
 *
 * kenari and DeepSeek additionally carry their provider-specific reports
 * (Rupiah wallet/quota, prepaid balance) — those two expose far more than a
 * generic limit list, and the richer card is what the user already reads.
 */

import { fetchOmpRegistrySnapshot } from '@/server/lib/models/provider-registry.server';
import { readProviderIconUrls } from '@/server/lib/models/provider-icon.server';
import { buildDeepSeekReport } from '@/server/lib/usage/deepseek';
import { buildKenariReport } from '@/server/lib/usage/kenari';
import { fetchOmpUsageSnapshot, type OmpUsageSnapshot } from '@/server/lib/usage/omp-usage.server';
import { fetchVendorBalance, type VendorBalance } from '@/server/lib/usage/vendor-balance.server';
import { kenariProviderSlugs, listCredentialedProviders, type CredentialedProvider } from '@/server/lib/usage/provider-key';
import { titleCaseProviderSlug } from '@/shared/lib/models/provider/label';
import type { KenariUsageReport, UsageProviderSummary } from '@/shared/types';

/** Slug aliases omp uses interchangeably, folded onto one display entry. */
const SLUG_ALIASES: Record<string, string> = {
  'command-code': 'commandcode',
};

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

function canonicalSlug(slug: string): string {
  const lower = slug.trim().toLowerCase();
  return SLUG_ALIASES[lower] ?? lower;
}

/** Human-readable provider name: brand spelling when known, title case otherwise. */
function displayName(slug: string): string {
  return BRAND_NAMES[slug] ?? titleCaseProviderSlug(slug);
}

/**
 * omp's own display names for the providers it knows (slug → name), e.g.
 * `commandcode` → "Command Code". Best-effort: a cold or busy omp degrades to
 * the slug-derived names.
 */
async function loadProviderNames(): Promise<Record<string, string>> {
  try {
    const { providers } = await fetchOmpRegistrySnapshot();
    const names: Record<string, string> = {};
    for (const provider of providers) {
      const slug = canonicalSlug(provider.id);
      const name = provider.name.trim();
      if (slug && name) names[slug] = name;
    }
    return names;
  } catch {
    // no-excuse-ok: catch — display names are supplementary, never load-bearing
    return {};
  }
}

/**
 * Fetch vendor balance windows for every slug that has an adapter. Failures are
 * per provider and never reject the batch.
 */
async function loadVendorBalances(slugs: string[]): Promise<Map<string, VendorBalance>> {
  const results = await Promise.all(
    slugs.map(async (slug) => [slug, await fetchVendorBalance(slug)] as const),
  );
  const balances = new Map<string, VendorBalance>();
  for (const [slug, balance] of results) {
    if (balance) balances.set(slug, balance);
  }
  return balances;
}

/** Merge credentialed slugs that resolve to the same canonical provider. */
function mergeCredentials(entries: CredentialedProvider[]): Map<string, string[]> {
  const bySlug = new Map<string, string[]>();
  for (const entry of entries) {
    const slug = canonicalSlug(entry.slug);
    if (!slug) continue;
    const sources = bySlug.get(slug) ?? [];
    for (const source of entry.sources) {
      if (!sources.includes(source)) sources.push(source);
    }
    bySlug.set(slug, sources);
  }
  return bySlug;
}

/**
 * Whether omp ships a usage adapter for `slug`, and whether that adapter came
 * back empty.
 *
 * `omp usage --json` names a provider in `accountsWithoutUsage` **only when it
 * has an adapter whose fetch produced nothing** — a provider omp does not track
 * never appears there at all (verified: with a stored DeepSeek key and no
 * adapter it is absent; with a stored Anthropic key and a failing fetch it is
 * present). So the slug's presence is exactly the "tracked but empty" signal,
 * and a provider that is neither in `reports` nor in `accountsWithoutUsage` has
 * no quota endpoint to speak of.
 */
export function resolveUsageTracking(
  slug: string,
  snapshot: Pick<OmpUsageSnapshot, 'reports' | 'accountsWithoutUsage'>,
): { tracked: boolean; limitsUnavailable: boolean } {
  const limitsUnavailable = snapshot.accountsWithoutUsage.includes(slug);
  return {
    tracked: snapshot.reports.has(slug) || limitsUnavailable,
    limitsUnavailable,
  };
}

/**
 * Build the provider rows. Providers are ordered by display name so the
 * sidebar and the right-panel picker list them identically.
 *
 * `force` bypasses the provider-quota cache (see `fetchOmpUsageSnapshot`).
 */
export async function buildUsageProviders(options: { force?: boolean } = {}): Promise<UsageProviderSummary[]> {
  const [credentialed, snapshot, names, iconUrls] = await Promise.all([
    listCredentialedProviders(),
    fetchOmpUsageSnapshot({ force: options.force }),
    loadProviderNames(),
    readProviderIconUrls(),
  ]);

  const credentials = mergeCredentials(credentialed);
  // Each Kenari provider carries its own report: two accounts share the same
  // upstream endpoints, so gating on the literal slug `kenari` left a second
  // one (`kenari2`) with no quota card while its key was never read. DeepSeek
  // still resolves by its canonical slug.
  const kenariSlugs = await kenariProviderSlugs(credentials.keys());
  const [kenariReports, deepseek, balances] = await Promise.all([
    Promise.all([...kenariSlugs].map(async (slug) => [slug, await buildKenariReport(slug)] as const)),
    credentials.has('deepseek') ? buildDeepSeekReport() : Promise.resolve(null),
    loadVendorBalances([...credentials.keys()]),
  ]);
  const kenariBySlug = new Map<string, KenariUsageReport>();
  for (const [slug, report] of kenariReports) {
    if (report) kenariBySlug.set(slug, report);
  }

  const summaries: UsageProviderSummary[] = [];
  for (const [slug, sources] of credentials) {
    const report = snapshot.reports.get(slug);
    const balance = balances.get(slug);
    const { tracked, limitsUnavailable } = resolveUsageTracking(slug, snapshot);
    const summary: UsageProviderSummary = {
      id: slug,
      name: names[slug] ?? displayName(slug),
      ...(iconUrls.get(slug) ? { iconUrl: iconUrls.get(slug) } : {}),
      credentialSources: sources,
      // A vendor balance is real quota data even when omp has no adapter for it.
      tracked: tracked || Boolean(balance && balance.limits.length > 0),
      limits: [...(report?.limits ?? []), ...(balance?.limits ?? [])],
      ...(limitsUnavailable ? { limitsUnavailable: true } : {}),
      ...(report?.notes ? { notes: report.notes } : {}),
    };

    const kenariReport = kenariBySlug.get(slug);
    if (kenariReport) {
      summary.kenari = kenariReport;
      if (kenariReport.error) summary.error = kenariReport.error;
    } else if (slug === 'deepseek' && deepseek) {
      summary.deepseek = deepseek;
      if (deepseek.error) summary.error = deepseek.error;
    } else if (balance?.error && !summary.error) {
      // Only surface a balance failure when nothing richer already reported one.
      summary.error = balance.error;
    }
    summaries.push(summary);
  }

  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}
