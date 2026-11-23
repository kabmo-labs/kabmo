/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * TokenPortal wallet (`GET https://tokenportal.id/v1/key`).
 *
 * The endpoint is OpenRouter-shaped — `data.limit` / `data.limit_remaining` /
 * `data.usage` — but the live body (verified 2026-11-23 with the stored `tp-`
 * key) reports money itself, not a token ledger:
 *
 *   {"data":{"label":"Kabmo","currency":"IDR","balance":8827,"limit":null,
 *            "limit_remaining":8827,"is_free_tier":false,
 *            "session_budget":null,"subscription":null}}
 *
 * So `balance` and `limit_remaining` are whole Rupiah, not cents: dividing them
 * or formatting them as USD misstates the wallet by four orders of magnitude.
 * `/v1/key` 404s on every other configured gateway (aihub/new-api, kiosapi,
 * clevecode, nutaraline, sumopod, helipod, token-harbor), so identity is the
 * host and nothing else is probed.
 */

import { readOmpProviderApiKey } from '@/server/lib/omp/core/auth-credentials';
import { resolveProviderEndpoint, resolveStoredKey } from '@/server/lib/usage/provider-key';
import { fetchProviderJson } from '@/server/lib/usage/vendor-http';
import { num } from '@/server/lib/usage/window';
import { isRecord } from '@/shared/lib/util/guards';
import type {
  TokenPortalBalance,
  TokenPortalUsageReport,
  UsageLimitWindow,
  UsageUnit,
} from '@/shared/types';

const ORIGIN = 'https://tokenportal.id';

/** Currencies the panel can render; anything else keeps its amount verbatim. */
const MONEY_UNITS: Record<string, UsageUnit> = { IDR: 'idr', USD: 'usd' };

/** Whether a provider's base URL is TokenPortal (its `/v1` path is implied). */
export function isTokenPortalBaseUrl(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return false; // a malformed URL is not TokenPortal
  }
  return host === 'tokenportal.id' || host.endsWith('.tokenportal.id');
}

/** The key endpoint for a provider entry's base URL, or the canonical one. */
export function tokenPortalKeyUrl(baseUrl?: string): string {
  let origin = ORIGIN;
  if (baseUrl) {
    try {
      origin = new URL(baseUrl).origin;
    } catch {
      // A malformed base URL keeps the canonical origin; identity was checked
      // before this ran, so this is a broken entry, not another provider.
    }
  }
  return `${origin}/v1/key`;
}

/** `data` (or the root) out of the vendor envelope. */
function envelope(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) throw new Error('unexpected key response');
  return isRecord(payload.data) ? payload.data : payload;
}

/**
 * Map the key body into the report contract. A body without a currency or a
 * balance is a schema change, not an empty wallet, so it throws; the optional
 * caps degrade to null because a key legitimately has none.
 */
export function parseTokenPortalBalance(payload: unknown): TokenPortalBalance {
  const data = envelope(payload);
  const currency = typeof data.currency === 'string' ? data.currency.trim().toUpperCase() : '';
  const balance = num(data.balance);
  if (!currency || balance === undefined) throw new Error('unexpected key response');
  return {
    label: typeof data.label === 'string' && data.label.trim().length > 0 ? data.label.trim() : null,
    currency,
    balance,
    limit: num(data.limit) ?? null,
    limitRemaining: num(data.limit_remaining) ?? null,
    isFreeTier: data.is_free_tier === true,
    sessionBudget: num(data.session_budget) ?? null,
  };
}

/**
 * The wallet as the generic `UsageLimitWindow` list, so the sidebar hint and
 * any consumer that only understands quota windows still sees the numbers.
 *
 * The remaining amount outranks the cap: with `limit: null` the vendor still
 * reports `limit_remaining`, and that is the money left. The cap window only
 * exists when the operator set one, because a `used` fraction of a cap that was
 * never set would read as a reassuring 0%.
 */
export function tokenPortalWindows(balance: TokenPortalBalance): UsageLimitWindow[] {
  const unit = MONEY_UNITS[balance.currency] ?? 'unknown';
  const remaining = balance.limitRemaining ?? balance.balance;
  const limit = balance.limit ?? undefined;
  const spent = limit !== undefined && balance.limitRemaining !== null
    ? Math.max(0, limit - balance.limitRemaining)
    : undefined;
  const windows: UsageLimitWindow[] = [
    {
      id: 'tokenportal:balance',
      label: 'Credit balance',
      ...(spent !== undefined ? { used: spent } : {}),
      ...(limit !== undefined ? { limit } : {}),
      remaining,
      ...(limit !== undefined && spent !== undefined && limit > 0
        ? { usedFraction: spent / limit }
        : {}),
      unit,
      status: remaining <= 0 ? 'exhausted' : 'ok',
    },
  ];
  if (balance.sessionBudget !== null) {
    windows.push({
      id: 'tokenportal:session',
      label: 'Session budget',
      remaining: balance.sessionBudget,
      unit,
      status: balance.sessionBudget <= 0 ? 'exhausted' : 'ok',
    });
  }
  return windows;
}

/** The key and endpoint of one provider slug, when it is TokenPortal. */
async function resolveCredential(slug: string): Promise<{ apiKey: string; url: string } | null> {
  const endpoint = await resolveProviderEndpoint(slug);
  const apiKey = resolveStoredKey(endpoint?.apiKey ?? (await readOmpProviderApiKey(slug)));
  if (!apiKey) return null;
  // A stored base URL decides identity; without one (agent.db only) the slug is
  // all there is, and a wrong guess here would show one account's wallet under
  // another provider's name.
  const named = slug.toLowerCase().replace(/[-_\s]/g, '').includes('tokenportal');
  if (endpoint ? !isTokenPortalBaseUrl(endpoint.baseUrl) : !named) return null;
  return { apiKey, url: tokenPortalKeyUrl(endpoint?.baseUrl) };
}

async function fetchBalance(
  slug: string,
  credential: { apiKey: string; url: string },
): Promise<TokenPortalUsageReport> {
  try {
    const payload = await fetchProviderJson(credential.url, credential.apiKey, 'TokenPortal');
    return { balance: parseTokenPortalBalance(payload) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : `${slug} key request failed` };
  }
}

/**
 * Wallet reports for every credentialed slug that resolves to TokenPortal.
 * Providers with another endpoint are skipped, and one provider's failure never
 * rejects the batch: it lands on that provider's `error`.
 */
export async function buildTokenPortalReports(
  slugs: Iterable<string>,
): Promise<Map<string, TokenPortalUsageReport>> {
  const reports = new Map<string, TokenPortalUsageReport>();
  const targets = await Promise.all(
    [...slugs].map(async (slug) => ({ slug, credential: await resolveCredential(slug) })),
  );
  await Promise.all(
    targets.map(async ({ slug, credential }) => {
      if (!credential) return;
      reports.set(slug, await fetchBalance(slug, credential));
    }),
  );
  return reports;
}
