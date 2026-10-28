/**
 * Usage / balance contracts for the Settings → Usage panel.
 *
 * Served by `GET /api/settings/usage`. `providers` lists every provider whose
 * credential omp can resolve — a provider with no API key is omitted, never
 * shown as an empty row. Each entry carries the provider's own quota windows
 * (`omp usage --json`), the token/cost burn omp recorded locally for the
 * trailing 30 days, and — for kenari and DeepSeek — the richer provider-specific
 * report described below. `error` carries a human-readable failure when an
 * upstream call could not be completed.
 */

/** A single rolling quota window from kenari's plan (week / month / 5 hours). */
export interface KenariQuotaWindow {
  key: 'five_hour' | 'week' | 'month';
  label: string;
  usedRp: number;
  remainingRp: number;
  /** RFC 3339 UTC timestamp of the next roll. */
  resetsAt: string;
}

/** An active kenari coupon, shown separately from the plan windows. */
export interface KenariCoupon {
  name: string;
  usedRp: number;
  /** Null when the coupon has no spending limit. */
  remainingRp: number | null;
  expiresAt: string;
  scopeModels: string[];
}

/** kenari plan + coupon quota (`GET /v1/account/quota`). */
export interface KenariQuota {
  planName: string | null;
  windows: KenariQuotaWindow[];
  coupon: KenariCoupon | null;
}

/** One model row from the kenari 30-day usage report. */
export interface KenariUsageRow {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costRp: number;
}

/** kenari 30-day usage per model (`kenari_usage` MCP tool). */
export interface KenariUsage {
  rows: KenariUsageRow[];
  totalRequests: number;
  totalCostRp: number;
  /** Raw text returned by the MCP tool, kept for display fallbacks. */
  raw: string;
}

/** kenari wallet balance (`kenari_balance` MCP tool). */
export interface KenariBalance {
  /** Parsed Rupiah amount, or null when the text could not be parsed. */
  amountRp: number | null;
  /** Raw text returned by the MCP tool. */
  raw: string;
}

/**
 * kenari wallet, plan quota, and 30-day usage. Present only when kenari has a
 * credential; the builder returns `null` otherwise, so no `configured` flag is
 * needed on the report itself.
 */
export interface KenariUsageReport {
  balance?: KenariBalance;
  usage?: KenariUsage;
  quota?: KenariQuota;
  error?: string;
}

/** One currency bucket from DeepSeek's balance response. */
export interface DeepSeekBalanceEntry {
  currency: string;
  totalBalance: string;
  grantedBalance: string;
  toppedUpBalance: string;
}

/** DeepSeek prepaid balance (`GET https://api.deepseek.com/user/balance`). */
export interface DeepSeekBalance {
  isAvailable: boolean;
  entries: DeepSeekBalanceEntry[];
}

/** DeepSeek prepaid balance; present only when DeepSeek has a credential. */
export interface DeepSeekUsageReport {
  balance?: DeepSeekBalance;
  error?: string;
}

/** Unit of a provider-reported quota amount (mirrors omp's `UsageUnit`). */
export type UsageUnit = 'percent' | 'tokens' | 'requests' | 'credits' | 'usd' | 'minutes' | 'bytes' | 'unknown';

/** Coarse state of one quota window. */
export type UsageWindowStatus = 'ok' | 'warning' | 'exhausted' | 'unknown';

/**
 * One quota window reported by a provider's own usage endpoint, flattened from
 * omp's `UsageLimit` (`omp usage --json`). Every amount is optional: providers
 * populate different subsets (`used`/`limit`, `usedFraction`, or
 * `remainingFraction`), and `usedFraction` is pre-resolved here with omp's own
 * precedence so the UI never has to re-derive it.
 */
export interface UsageLimitWindow {
  id: string;
  label: string;
  /** Compact window label from omp, e.g. "5h" or "7d". */
  windowLabel?: string;
  /** Model/account scope when the provider reports per-model windows. */
  modelId?: string;
  accountId?: string;
  used?: number;
  limit?: number;
  remaining?: number;
  /** Fraction used, 0..1; values above 1 mean overage. */
  usedFraction?: number;
  unit: UsageUnit;
  status: UsageWindowStatus;
  /** Epoch ms when the window rolls over. */
  resetsAt?: number;
  notes?: string[];
}

/**
 * One provider row in the Usage surfaces. Only providers whose credentials
 * were actually detected are present — a provider with no key is absent from
 * `UsageReport.providers` entirely rather than shown as "not configured".
 */
export interface UsageProviderSummary {
  /** Stable id (provider slug, lowercased) used for selection + persistence. */
  id: string;
  name: string;
  /**
   * The provider's own web icon, when one has been fetched and stored.
   *
   * Both usage surfaces draw a provider mark, and they drew the built-in glyph
   * table — which cannot know a `models.yml` gateway, so those rows showed
   * initials while the provider list showed the site's logo for the same
   * provider. Carried on the summary because the usage payload does not include
   * the provider registry.
   */
  iconUrl?: string;
  /** Where the credential was found ("models.yml", "agent.db", "app DB"). */
  credentialSources: string[];
  /**
   * Whether omp ships a usage adapter for this provider. False means omp has no
   * quota endpoint for it at all (kenari, DeepSeek, arbitrary OpenAI-compatible
   * gateways), which is different from an adapter that returned nothing — see
   * `limitsUnavailable`.
   */
  tracked: boolean;
  /**
   * True when omp DOES track this provider but its endpoint produced no data
   * (invalid or expired credential, unreachable endpoint, or a plan exposing no
   * quota). Distinguishes "nothing to report" from "not supported".
   */
  limitsUnavailable?: boolean;
  /** Provider-wide caveats from its usage report (e.g. spend is omp-observed). */
  notes?: string[];
  /** Human-readable failure from the provider's usage endpoint, when it failed. */
  error?: string;
  /** Native quota windows; empty when the provider exposes no usage endpoint. */
  limits: UsageLimitWindow[];
  /** Rich kenari report (wallet, Rupiah plan windows, MCP usage table). */
  kenari?: KenariUsageReport;
  /** Rich DeepSeek report (prepaid balance). */
  deepseek?: DeepSeekUsageReport;
}

/** Response body of `GET /api/settings/usage`. */
export interface UsageReport {
  isMock: boolean;
  generatedAt: string;
  /** Every provider with a detected credential, ordered by display name. */
  providers: UsageProviderSummary[];
}

/**
 * One saved rate-limit reset credit, from `omp usage reset --json`.
 *
 * Codex and Claude issue these when a window is constrained; spending one
 * clears the covered window. Everything but `id` is optional because omp
 * reports different subsets per provider.
 */
export interface UsageResetCredit {
  id: string;
  title?: string;
  program?: string;
  status?: string;
  remainingCount?: number;
  /** False when the provider will not let this credit be spent right now. */
  usable?: boolean;
  requiresLimit?: boolean;
  /** Windows this credit clears, e.g. `["anthropic:5h"]`. */
  clears?: string[];
  blocking?: boolean;
  usedFractions?: number[];
  grantedAt?: number;
  expiresAt?: number;
}

/**
 * One account holding saved resets. `provider` + `credentialId` is exactly the
 * target grammar `omp usage reset <provider>/<credential id>` takes, which is
 * why a row without either is dropped rather than rendered.
 */
export interface UsageResetAccount {
  provider: string;
  credentialId: string;
  email?: string;
  accountId?: string;
  orgId?: string;
  orgName?: string;
  /** Credits the provider reports on the account. */
  availableCount?: number;
  /** Of those, the ones a spend may actually use. */
  redeemableCount?: number;
  nextCreditId?: string;
  /** Epoch ms of the soonest expiry — omp warns as one approaches. */
  soonestExpiry?: number;
  /** Why nothing can be spent right now (set by omp when redeemable is 0). */
  unavailableReason?: string;
  error?: string;
  credits: UsageResetCredit[];
}

/** Response body of `GET /api/settings/usage/reset`. */
export interface UsageResetList {
  generatedAt: number;
  accounts: UsageResetAccount[];
  /** omp's own reason when the LIST failed; absent on a successful read. */
  error?: string;
}

/** Response body of `POST /api/settings/usage/reset`. */
export interface UsageResetSpendResult {
  ok: boolean;
  /** omp's own sentence either way — it names the outcome, including refusals. */
  message: string;
}
