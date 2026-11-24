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
 *
 * One provider is read by Kabmo itself rather than by omp: Antigravity's quota
 * comes from the local Antigravity sign-in (`usage/antigravity.ts`), because
 * omp's adapter only runs on omp's own credential and a machine signed in
 * through the CLI showed an empty card. omp's answer still wins when it exists,
 * so the same numbers never arrive twice.
 */

import { fetchOmpRegistrySnapshot } from '@/server/lib/models/provider-registry.server';
import { readProviderIconUrls } from '@/server/lib/models/provider-icon.server';
import { buildLocalAntigravityReport } from '@/server/lib/usage/antigravity';
import {
  ANTIGRAVITY_CREDENTIAL_SOURCE,
  ANTIGRAVITY_PROVIDER_ID,
  type LocalAntigravityReport,
} from '@/server/lib/usage/antigravity-quota';
import { buildDeepSeekReport } from '@/server/lib/usage/deepseek';
import { buildKenariReport } from '@/server/lib/usage/kenari';
import { buildNewApiReports } from '@/server/lib/usage/new-api';
import { allowanceWindows, buildTokenHarborReports } from '@/server/lib/usage/token-harbor';
import { buildTokenPortalReports, tokenPortalWindows } from '@/server/lib/usage/token-portal';
import { fetchOmpUsageSnapshot, type OmpUsageSnapshot } from '@/server/lib/usage/omp-usage.server';
import { fetchVendorBalance, type VendorBalance } from '@/server/lib/usage/vendor-balance.server';
import { kenariProviderSlugs, listCredentialedProviders, type CredentialedProvider } from '@/server/lib/usage/provider-key';
import { isAntigravityProviderSlug } from '@/shared/lib/models/provider/identity';
import { canonicalProviderSlug, providerDisplayName } from '@/shared/lib/models/provider/label';
import type { KenariUsageReport, UsageLimitWindow, UsageProviderSummary } from '@/shared/types';

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
      const slug = canonicalProviderSlug(provider.id);
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
    const slug = canonicalProviderSlug(entry.slug);
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
 * The local Antigravity windows one provider row takes.
 *
 * omp's own adapter covers the same buckets when IT holds the credential, so its
 * answer wins: the same numbers from two sources would draw every window twice.
 * A local read that failed contributes its reason only when the row would
 * otherwise be silent — an error is content, not a fallback.
 */
export function localAntigravityLimits(
  ompLimits: UsageLimitWindow[],
  local: LocalAntigravityReport | null,
): { windows: UsageLimitWindow[]; error?: string } {
  if (!local || ompLimits.length > 0) return { windows: [] };
  return {
    windows: local.windows,
    ...(local.windows.length === 0 && local.error ? { error: local.error } : {}),
  };
}

/**
 * The row a machine-signed-in Antigravity gets when omp lists no such provider.
 * The local keyring credential is a credential in its own right, so the row is
 * `tracked` — Kabmo, not omp, reads this one.
 */
export function localAntigravityRow(
  report: LocalAntigravityReport,
  name: string,
  iconUrl?: string,
): UsageProviderSummary {
  return {
    id: ANTIGRAVITY_PROVIDER_ID,
    name,
    ...(iconUrl ? { iconUrl } : {}),
    credentialSources: [ANTIGRAVITY_CREDENTIAL_SOURCE],
    tracked: true,
    limits: report.windows,
    ...(report.error ? { error: report.error } : {}),
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
  const [kenariReports, deepseek, balances, gateways, tokenHarbor, tokenPortal, localReport] = await Promise.all([
    Promise.all([...kenariSlugs].map(async (slug) => [slug, await buildKenariReport(slug)] as const)),
    credentials.has('deepseek') ? buildDeepSeekReport() : Promise.resolve(null),
    loadVendorBalances([...credentials.keys()]),
    // Self-hosted relays answer on the provider's OWN base URL, so they cannot
    // live in `vendor-balance`'s fixed-URL table.
    buildNewApiReports(credentials.keys()),
    buildTokenHarborReports(credentials.keys()),
    buildTokenPortalReports(credentials.keys()),
    buildLocalAntigravityReport({ force: options.force }),
  ]);
  const kenariBySlug = new Map<string, KenariUsageReport>();
  for (const [slug, report] of kenariReports) {
    if (report) kenariBySlug.set(slug, report);
  }

  const summaries: UsageProviderSummary[] = [];
  for (const [slug, sources] of credentials) {
    const report = snapshot.reports.get(slug);
    const balance = balances.get(slug);
    const gateway = gateways.get(slug);
    const harbor = tokenHarbor.get(slug);
    const harborWindows = harbor?.allowance ? allowanceWindows(harbor.allowance) : [];
    const portal = tokenPortal.get(slug);
    const portalWindows = portal?.balance ? tokenPortalWindows(portal.balance) : [];
    const antigravity = isAntigravityProviderSlug(slug);
    // Local Antigravity quota fills the gap omp leaves: its adapter only runs on
    // omp's own credential store, while the CLI keeps its sign-in in the OS
    // keyring.
    const antigravityLimits = antigravity
      ? localAntigravityLimits(report?.limits ?? [], localReport)
      : { windows: [] };
    const { tracked, limitsUnavailable } = resolveUsageTracking(slug, snapshot);
    const summary: UsageProviderSummary = {
      id: slug,
      name: names[slug] ?? providerDisplayName(slug),
      ...(iconUrls.get(slug) ? { iconUrl: iconUrls.get(slug) } : {}),
      credentialSources: sources,
      // A vendor balance is real quota data even when omp has no adapter for it.
      tracked: tracked
        || Boolean(balance?.limits.length)
        || Boolean(gateway?.limits.length)
        || harborWindows.length > 0
        || portalWindows.length > 0
        || antigravityLimits.windows.length > 0,
      limits: [
        ...(report?.limits ?? []),
        ...(balance?.limits ?? []),
        ...(gateway?.limits ?? []),
        ...harborWindows,
        ...portalWindows,
        ...antigravityLimits.windows,
      ],
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
    } else if (harbor) {
      summary.tokenHarbor = harbor;
      if (harbor.error) summary.error = harbor.error;
    } else if (portal) {
      summary.tokenPortal = portal;
      if (portal.error) summary.error = portal.error;
    } else if (gateway?.error) {
      summary.error = gateway.error;
    } else if (balance?.error && !summary.error) {
      // Only surface a balance failure when nothing richer already reported one.
      summary.error = balance.error;
    } else if (antigravity && !summary.error && antigravityLimits.error) {
      // The local read failed and nothing else explains the empty card.
      summary.error = antigravityLimits.error;
    }
    summaries.push(summary);
  }

  // A machine can run Antigravity without omp knowing it as a provider: the
  // CLI's sign-in sits in the OS keyring, which omp's provider list only sees
  // when it was wired up there. A local sign-in is a credential in its own
  // right, so it earns a row; when omp already lists the provider, that row
  // carries the local windows instead of a second one appearing beside it.
  if (localReport && ![...credentials.keys()].some(isAntigravityProviderSlug)) {
    summaries.push(localAntigravityRow(
      localReport,
      names[ANTIGRAVITY_PROVIDER_ID] ?? providerDisplayName(ANTIGRAVITY_PROVIDER_ID),
      iconUrls.get(ANTIGRAVITY_PROVIDER_ID),
    ));
  }

  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}
