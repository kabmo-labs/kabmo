/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Token Harbor allowance (`GET https://tokenharbor.ai/api/cli/free-tier`).
 *
 * The only usage endpoint Token Harbor documents for a plain API key: one
 * read-only, free call that returns the account's Pass allowance and its
 * free-model allowance as TWO integer percentages sharing ONE 7-day window.
 * There is no per-request history, no cost, and no dollar remainder over the
 * API (those live on the dashboard only), so the report carries percentages
 * and the card never invents an amount.
 *
 * omp ships no usage adapter for Token Harbor, and the provider can be
 * registered under ANY slug (`token-harbour`, `tokenharbor`, a personal name),
 * so identity comes from the BASE URL host, the same rule `new-api.ts` uses.
 * The slug spelling is the fallback only for a credential that exists in
 * agent.db, which carries no URL at all.
 *
 * Verified against the live endpoint with a stored `thk_live_…` key: the
 * response also carries undocumented fields (`req_used`, `rpm_limit`,
 * `buffer_pct`, `campaign*`, …). They are not part of the documented contract
 * and are deliberately ignored here.
 */

import { readOmpProviderApiKey } from '@/server/lib/omp/core/auth-credentials';
import { resolveProviderEndpoint, resolveStoredKey } from '@/server/lib/usage/provider-key';
import { fetchProviderJson } from '@/server/lib/usage/vendor-http';
import { num } from '@/server/lib/usage/window';
import type {
  TokenHarborAllowance,
  TokenHarborUsageReport,
  UsageLimitWindow,
  UsageWindowStatus,
} from '@/shared/types';
import { isRecord } from '@/shared/lib/util/guards';

const ORIGIN = 'https://tokenharbor.ai';

/** Whether a provider's base URL is Token Harbor (its `/v1` path is implied). */
export function isTokenHarborBaseUrl(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return false; // a malformed URL is not Token Harbor
  }
  return host === 'tokenharbor.ai' || host.endsWith('.tokenharbor.ai');
}

/** The allowance endpoint for a provider entry's base URL, or the canonical one. */
export function tokenHarborAllowanceUrl(baseUrl?: string): string {
  let origin = ORIGIN;
  if (baseUrl) {
    try {
      origin = new URL(baseUrl).origin;
    } catch {
      // A malformed base URL keeps the canonical origin; identity was checked
      // before this ran, so this is a broken entry, not another provider.
    }
  }
  return `${origin}/api/cli/free-tier`;
}

/** A percentage clamped to 0-100; null when the field is missing or not a number. */
function clampPercent(value: unknown): number | null {
  const parsed = num(value);
  if (parsed === undefined) return null;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

/** An ISO timestamp string, or null for the `null` the endpoint sends pre-activation. */
function timestamp(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Map the allowance body into the report contract. A body that is not an object
 * is a schema change, not an empty account, so it throws; every field inside
 * degrades individually because the card has a state for each of them.
 */
export function parseTokenHarborAllowance(payload: unknown): TokenHarborAllowance {
  if (!isRecord(payload)) throw new Error('unexpected allowance response');
  return {
    planName: typeof payload.plan_name === 'string' && payload.plan_name.trim().length > 0
      ? payload.plan_name.trim()
      : null,
    onPlan: payload.on_plan === true,
    planUsedPct: clampPercent(payload.plan_used_pct),
    planExhausted: payload.plan_exhausted === true,
    usedPct: clampPercent(payload.used_pct),
    exhausted: payload.exhausted === true,
    activated: payload.activated === true,
    resetAt: timestamp(payload.reset_at),
    periodStartedAt: timestamp(payload.period_started_at),
    periodEndsAt: timestamp(payload.period_ends_at),
    freeModels: stringList(payload.models),
    // Absent is not "off": only an explicit false turns the free models off.
    modelsEnabled: payload.models_enabled !== false,
  };
}

/**
 * The allowance as the generic `UsageLimitWindow` list the provider summary
 * carries, so every consumer that only understands quota windows (the sidebar
 * hint, any future panel) still sees Token Harbor's numbers.
 *
 * The status rule is the contract's, not arithmetic: `plan_exhausted`/
 * `exhausted` decide "spent", because the percentages are rounded integers. A
 * window that never started reports `unknown` instead of a reassuring 0%.
 *
 * No `notes` are attached: the rich card replaces `LimitsSection` for this
 * provider, so a note here would never render. The card states the same facts.
 */
export function allowanceWindows(allowance: TokenHarborAllowance): UsageLimitWindow[] {
  const resetsAt = allowance.activated && allowance.resetAt ? Date.parse(allowance.resetAt) : undefined;
  const window = (
    id: string,
    label: string,
    pct: number | null,
    spent: boolean,
  ): UsageLimitWindow => {
    const usedFraction = pct === null ? undefined : pct / 100;
    const status: UsageWindowStatus = !allowance.activated
      ? 'unknown'
      : spent
        ? 'exhausted'
        : pct !== null && pct >= 80
          ? 'warning'
          : 'ok';
    return {
      id,
      label,
      windowLabel: '7d',
      ...(pct !== null ? { used: pct, limit: 100 } : {}),
      ...(usedFraction !== undefined ? { usedFraction } : {}),
      unit: 'percent',
      status,
      ...(resetsAt !== undefined && !Number.isNaN(resetsAt) ? { resetsAt } : {}),
    };
  };

  const windows: UsageLimitWindow[] = [];
  if (allowance.onPlan) {
    windows.push(window('tokenharbor:pass', allowance.planName ?? 'Pass allowance', allowance.planUsedPct, allowance.planExhausted));
  }
  windows.push(window('tokenharbor:free', 'Free allowance', allowance.usedPct, allowance.exhausted));
  return windows;
}

/** The key and endpoint of one provider slug, when it is Token Harbor. */
async function resolveCredential(
  slug: string,
): Promise<{ apiKey: string; url: string } | null> {
  const endpoint = await resolveProviderEndpoint(slug);
  const apiKey = resolveStoredKey(endpoint?.apiKey ?? (await readOmpProviderApiKey(slug)));
  if (!apiKey) return null;
  // A stored base URL decides identity; without one (agent.db only) the slug is
  // all there is, and a wrong guess here would show one account's allowance
  // under another provider's name.
  const named = slug.toLowerCase().replace(/[-_\s]/g, '').includes('tokenharbor');
  if (endpoint ? !isTokenHarborBaseUrl(endpoint.baseUrl) : !named) return null;
  return { apiKey, url: tokenHarborAllowanceUrl(endpoint?.baseUrl) };
}

async function fetchAllowance(
  slug: string,
  credential: { apiKey: string; url: string },
): Promise<TokenHarborUsageReport> {
  try {
    const payload = await fetchProviderJson(credential.url, credential.apiKey, 'Token Harbor');
    return { allowance: parseTokenHarborAllowance(payload) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : `${slug} allowance request failed` };
  }
}

/**
 * Allowance reports for every credentialed slug that resolves to Token Harbor.
 * Providers with another endpoint are skipped, and one provider's failure
 * never rejects the batch: it lands on that provider's `error`.
 */
export async function buildTokenHarborReports(
  slugs: Iterable<string>,
): Promise<Map<string, TokenHarborUsageReport>> {
  const reports = new Map<string, TokenHarborUsageReport>();
  const targets = await Promise.all(
    [...slugs].map(async (slug) => ({ slug, credential: await resolveCredential(slug) })),
  );
  await Promise.all(
    targets.map(async ({ slug, credential }) => {
      if (!credential) return;
      reports.set(slug, await fetchAllowance(slug, credential));
    }),
  );
  return reports;
}
