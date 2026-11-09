/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * New API gateways (github.com/Calcium-Ion/new-api, a one-api fork).
 *
 * A gateway is not a vendor with one fixed endpoint: every deployment lives at
 * its own base URL, and the provider is registered under the user's own slug
 * (`aihub-brisnets-jatis`), so the URL has to come from the provider entry.
 * The host is the only thing that identifies the family.
 *
 * Verified against aihub.brisnets.com (New API `v1.0.0-rc.26-aihub.3.12`,
 * `quota_display_type` USD, `quota_per_unit` 500000) with the stored `sk-` key:
 *
 *   GET <base>/dashboard/billing/usage        → {"object":"list","total_usage":1365.635}
 *   GET <base>/dashboard/billing/subscription → {"hard_limit_usd":100000000,…}
 *   GET /api/user/self                        → 401 "invalid access token"
 *
 * `total_usage` is USD **cents** (`amount * 100` in controller/billing.go), and
 * `hard_limit_usd` is `remaining + used`. The literal 100000000 is the sentinel
 * New API writes for a token with `unlimited_quota`, not a real balance. Real
 * account balance needs a console **access token** on `/api/user/self`; an
 * `sk-` key cannot read it, so an unlimited key shows spend only.
 */

import { resolveProviderEndpoint, type ProviderEndpoint } from '@/server/lib/usage/provider-key';
import { fetchProviderJson } from '@/server/lib/usage/vendor-http';
import type { VendorBalance } from '@/server/lib/usage/vendor-balance.server';
import { num, usdWindow } from '@/server/lib/usage/window';
import { isRecord } from '@/shared/lib/util/guards';
import type { UsageLimitWindow } from '@/shared/types';

/**
 * Hosts that serve New API. `easyaihub.ai` is the same operator's China domain
 * (`/api/status` advertises it next to `aihub.brisnets.com`).
 */
const GATEWAY_HOSTS: readonly string[] = ['aihub.brisnets.com', 'easyaihub.ai'];

/** New API's "no limit on this token" marker, not a dollar amount. */
const UNLIMITED_SENTINEL = 100_000_000;

/** Whether a provider's base URL is a New API gateway. */
export function isNewApiGatewayBaseUrl(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return false; // a malformed URL is not a gateway
  }
  return GATEWAY_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

/** A billing endpoint under the provider's base URL (`…/v1` is implied). */
export function newApiBillingUrl(baseUrl: string, path: 'usage' | 'subscription'): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  const base = /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
  return `${base}/dashboard/billing/${path}`;
}

/**
 * Map the two billing payloads into quota windows. `usage` is required — a body
 * without `total_usage` is a schema change, not an empty balance — while the
 * subscription is best-effort because the spend alone is still useful.
 */
export function parseNewApiBilling(
  slug: string,
  usage: unknown,
  subscription?: unknown,
): UsageLimitWindow[] {
  const spentCents = isRecord(usage) ? num(usage.total_usage) : undefined;
  if (spentCents === undefined) throw new Error('unexpected billing response');
  const used = spentCents / 100;
  const limit = isRecord(subscription) ? num(subscription.hard_limit_usd) : undefined;

  if (limit === undefined || limit >= UNLIMITED_SENTINEL) {
    return [
      usdWindow({
        id: `${slug}:spent`,
        label: 'Spent (all time)',
        used,
        note: 'This key has no spending limit; the remaining balance is in the gateway console.',
      }),
    ];
  }

  return [
    usdWindow({
      id: `${slug}:credit`,
      label: 'Key credit',
      used,
      limit,
      remaining: Math.max(0, limit - used),
    }),
  ];
}

async function fetchGatewayBilling(slug: string, endpoint: ProviderEndpoint): Promise<VendorBalance> {
  try {
    const [usage, subscription] = await Promise.all([
      fetchProviderJson(newApiBillingUrl(endpoint.baseUrl, 'usage'), endpoint.apiKey, slug),
      // A failed subscription leaves the spend intact; only the limit is lost.
      fetchProviderJson(newApiBillingUrl(endpoint.baseUrl, 'subscription'), endpoint.apiKey, slug)
        .catch(() => undefined),
    ]);
    return { limits: parseNewApiBilling(slug, usage, subscription) };
  } catch (error) {
    return {
      limits: [],
      error: error instanceof Error ? error.message : `${slug} usage request failed`,
    };
  }
}

/**
 * Billing reports for every credentialed slug whose stored endpoint is a New
 * API gateway. Providers with another endpoint are silently skipped, and one
 * provider's failure never rejects the batch.
 */
export async function buildNewApiReports(slugs: Iterable<string>): Promise<Map<string, VendorBalance>> {
  const reports = new Map<string, VendorBalance>();
  const targets = await Promise.all(
    [...slugs].map(async (slug) => [slug, await resolveProviderEndpoint(slug)] as const),
  );
  await Promise.all(targets.map(async ([slug, endpoint]) => {
    if (!endpoint || !isNewApiGatewayBaseUrl(endpoint.baseUrl)) return;
    reports.set(slug, await fetchGatewayBilling(slug, endpoint));
  }));
  return reports;
}
