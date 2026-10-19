/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider-reported BALANCE endpoints, for vendors that expose one to a plain
 * API key.
 *
 * This is a deliberately narrow complement to `omp usage --json`, not a
 * replacement: omp ships ~20 usage adapters, but they cover subscription plans
 * (rolling 5h/7d windows). Pay-as-you-go vendors are not among them, and a
 * credit balance is the only "quota" they have — so those are fetched here.
 *
 * Every endpoint below was verified to exist and to accept an ordinary API key
 * (a bogus key returns 401, not 404). Anthropic and OpenAI are NOT here on
 * purpose: their usage/cost reports require an org ADMIN key
 * (`sk-ant-admin01-…`) that a normal workspace key cannot substitute, so the
 * Kabmo cannot read them with the credential the user actually configured.
 *
 * Results are shaped as `UsageLimitWindow[]` so the existing quota renderer
 * draws them — a balance is just a window whose unit is USD.
 */

import { readOmpProviderApiKey } from '@/server/lib/omp/core/auth-credentials';
import { loadProviderEntries } from '@/server/lib/usage/provider-key';
import { isRecord } from '@/shared/lib/util/guards';
import type { UsageLimitWindow, UsageWindowStatus } from '@/shared/types';

const FETCH_TIMEOUT_MS = 10_000;
const MASKED_KEY_PATTERN = /•{3,}/;

/** A vendor balance adapter: where to ask, and how to read the answer. */
interface BalanceAdapter {
  /** Provider slug as omp spells it. */
  slug: string;
  /** Env var omp reads for this provider, used when no stored key exists. */
  envKey: string;
  url: string;
  /** Map the parsed JSON body into quota windows. Throws on an unusable body. */
  parse: (payload: unknown) => UsageLimitWindow[];
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Status for a credit window: exhausted at zero remaining, else ok. */
function balanceStatus(remaining: number | undefined): UsageWindowStatus {
  if (remaining === undefined) return 'unknown';
  return remaining <= 0 ? 'exhausted' : 'ok';
}

/** One USD window from a balance; `limit` is omitted when the vendor has none. */
function usdWindow(input: {
  id: string;
  label: string;
  used?: number;
  limit?: number;
  remaining?: number;
  note?: string;
}): UsageLimitWindow {
  const usedFraction = input.limit && input.limit > 0 && input.used !== undefined
    ? input.used / input.limit
    : undefined;
  return {
    id: input.id,
    label: input.label,
    unit: 'usd',
    status: balanceStatus(input.remaining),
    ...(input.used !== undefined ? { used: input.used } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.remaining !== undefined ? { remaining: input.remaining } : {}),
    ...(usedFraction !== undefined ? { usedFraction } : {}),
    ...(input.note ? { notes: [input.note] } : {}),
  };
}

/** Pull `data` (or the root) out of a vendor envelope. */
function envelope(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) throw new Error('unexpected balance response');
  return isRecord(payload.data) ? payload.data : payload;
}

const ADAPTERS: readonly BalanceAdapter[] = [
  {
    // Documented at openrouter.ai/docs — GET /api/v1/key returns the CURRENT
    // key's own limit/usage, so no management key is needed (unlike /credits).
    slug: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
    url: 'https://openrouter.ai/api/v1/key',
    parse: (payload) => {
      const data = envelope(payload);
      const limit = num(data.limit);
      const usage = num(data.usage);
      const remaining = num(data.limit_remaining);
      const reset = typeof data.limit_reset === 'string' ? data.limit_reset : undefined;
      const windows = [
        usdWindow({
          id: 'openrouter:credits',
          label: 'Key credits',
          used: usage,
          limit,
          remaining,
          note: limit === undefined ? 'No credit limit is set on this key.' : undefined,
        }),
      ];
      const daily = num(data.usage_daily);
      if (daily !== undefined) {
        windows.push(usdWindow({ id: 'openrouter:daily', label: `Spent today${reset ? ` (${reset})` : ''}`, used: daily }));
      }
      return windows;
    },
  },
  {
    // Moonshot / Kimi Open Platform: GET /v1/users/me/balance with a Bearer key.
    slug: 'moonshot',
    envKey: 'MOONSHOT_API_KEY',
    url: 'https://api.moonshot.ai/v1/users/me/balance',
    parse: (payload) => {
      const data = envelope(payload);
      const available = num(data.available_balance);
      const voucher = num(data.voucher_balance);
      const cash = num(data.cash_balance);
      const windows = [
        usdWindow({ id: 'moonshot:available', label: 'Available balance', remaining: available }),
      ];
      if (voucher !== undefined) {
        windows.push(usdWindow({ id: 'moonshot:voucher', label: 'Voucher balance', remaining: voucher }));
      }
      if (cash !== undefined) {
        windows.push(usdWindow({ id: 'moonshot:cash', label: 'Cash balance', remaining: cash }));
      }
      return windows;
    },
  },
  {
    // SiliconFlow: GET /v1/user/info → data.balance / chargeBalance / totalBalance.
    slug: 'siliconflow',
    envKey: 'SILICONFLOW_API_KEY',
    url: 'https://api.siliconflow.com/v1/user/info',
    parse: (payload) => {
      const data = envelope(payload);
      const total = num(data.totalBalance);
      const charge = num(data.chargeBalance);
      const windows = [
        usdWindow({ id: 'siliconflow:total', label: 'Total balance', remaining: total }),
      ];
      if (charge !== undefined) {
        windows.push(usdWindow({ id: 'siliconflow:charge', label: 'Topped-up balance', remaining: charge }));
      }
      return windows;
    },
  },
  {
    // Novita: GET /openapi/v1/billing/balance/detail. Amounts are in 1/10000 USD.
    slug: 'novita',
    envKey: 'NOVITA_API_KEY',
    url: 'https://api.novita.ai/openapi/v1/billing/balance/detail',
    parse: (payload) => {
      if (!isRecord(payload)) throw new Error('unexpected balance response');
      const scale = 1 / 10_000;
      const available = num(payload.availableBalance);
      const cash = num(payload.cashBalance);
      const creditLimit = num(payload.creditLimit);
      const windows = [
        usdWindow({
          id: 'novita:available',
          label: 'Available balance',
          remaining: available !== undefined ? available * scale : undefined,
          limit: creditLimit !== undefined ? creditLimit * scale : undefined,
        }),
      ];
      if (cash !== undefined) {
        windows.push(usdWindow({ id: 'novita:cash', label: 'Topped-up balance', remaining: cash * scale }));
      }
      return windows;
    },
  },
  {
    // DeepInfra: GET /payment/key-limits → one entry per API key with the
    // monthly spending limit and what that key has spent this month.
    slug: 'deepinfra',
    envKey: 'DEEPINFRA_TOKEN',
    url: 'https://api.deepinfra.com/payment/key-limits',
    parse: (payload) => {
      if (!Array.isArray(payload)) throw new Error('unexpected balance response');
      const windows: UsageLimitWindow[] = [];
      for (const entry of payload) {
        if (!isRecord(entry)) continue;
        const name = typeof entry.name === 'string' && entry.name ? entry.name : 'API key';
        const limit = num(entry.limit);
        const spend = num(entry.spend);
        windows.push(usdWindow({
          id: `deepinfra:${typeof entry.token_id === 'string' ? entry.token_id : name}`,
          label: `${name} · monthly`,
          used: spend,
          limit,
          remaining: limit !== undefined && spend !== undefined ? Math.max(0, limit - spend) : undefined,
          note: limit === undefined ? 'No monthly limit is set on this key.' : undefined,
        }));
      }
      return windows;
    },
  },
];

/** Balance adapters keyed by slug, for callers that need the table. */
export const BALANCE_ADAPTER_SLUGS: readonly string[] = ADAPTERS.map((adapter) => adapter.slug);

function adapterFor(slug: string): BalanceAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.slug === slug);
}

/**
 * Map a vendor's balance payload into quota windows, or null when the slug has
 * no adapter. Exported so the field mapping (the part that breaks when a vendor
 * changes its schema) is unit-testable without a network call.
 */
export function parseVendorBalance(slug: string, payload: unknown): UsageLimitWindow[] | null {
  const adapter = adapterFor(slug);
  if (!adapter) return null;
  return adapter.parse(payload);
}

/**
 * The provider's key: Kabmo overlay first, then omp's own stores, then
 * the environment variable omp itself reads. The env fallback matters because a
 * key can live only in the user's shell (omp picks it up there), which no store
 * on disk would reveal.
 */
async function resolveVendorKey(adapter: BalanceAdapter): Promise<string | null> {
  for (const entry of await loadProviderEntries()) {
    const slug = (entry.slug || entry.name).trim().toLowerCase();
    const key = entry.apiKey.trim();
    if (slug === adapter.slug && key && !MASKED_KEY_PATTERN.test(key)) return key;
  }
  const stored = await readOmpProviderApiKey(adapter.slug);
  if (stored) return stored;
  const fromEnv = Bun.env[adapter.envKey];
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : null;
}

export interface VendorBalance {
  limits: UsageLimitWindow[];
  error?: string;
}

/**
 * Fetch a vendor balance. Returns null when the provider has no balance
 * adapter, or when no credential could be resolved (a provider omp reports
 * through an env var Kabmo was not launched with is a silent miss, not an
 * error — the caller already knows the credential exists somewhere).
 */
export async function fetchVendorBalance(slug: string): Promise<VendorBalance | null> {
  const adapter = adapterFor(slug);
  if (!adapter) return null;
  const apiKey = await resolveVendorKey(adapter);
  if (!apiKey) return null;
  try {
    const response = await fetch(adapter.url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) {
      return { limits: [], error: `${adapter.slug} rejected the API key (HTTP ${response.status}).` };
    }
    if (response.status < 200 || response.status >= 300) {
      return { limits: [], error: `${adapter.slug} balance request failed (HTTP ${response.status}).` };
    }
    const limits = adapter.parse(await response.json());
    return { limits };
  } catch (error) {
    return {
      limits: [],
      error: error instanceof Error ? error.message : `${adapter.slug} balance request failed`,
    };
  }
}
