/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider quota/limit windows straight from omp's own `omp usage --json`.
 *
 * This is the only source of provider-REPORTED limits: omp ships a usage
 * adapter per provider (Anthropic, Codex, Z.ai, Copilot, Cursor, Gemini, …)
 * and the CLI already normalizes every one of them into the same
 * `UsageReport`/`UsageLimit` shape. Re-deriving that per provider here would
 * mean re-implementing each vendor's endpoint and drifting from omp on every
 * release.
 *
 * `omp usage` exits 0 even when nothing is reported (empty `reports`), so the
 * parse path — not the exit code — decides whether the snapshot is usable.
 * Cached briefly: the command walks every stored credential and calls each
 * provider's endpoint, so it is far too expensive to run per panel read.
 */

import { resolveOmpBin } from '@/server/lib/omp/core/cli';
import { isRecord } from '@/shared/lib/util/guards';
import type { UsageLimitWindow, UsageUnit, UsageWindowStatus } from '@/shared/types';
import { childEnv } from '@/server/lib/fs/child-env';

const TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 60_000;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

const UNITS: readonly UsageUnit[] = [
  'percent', 'tokens', 'requests', 'credits', 'usd', 'minutes', 'bytes', 'unknown',
];
const STATUSES: readonly UsageWindowStatus[] = ['ok', 'warning', 'exhausted', 'unknown'];

/** One provider section of `omp usage --json`. */
export interface OmpUsageReportEntry {
  provider: string;
  limits: UsageLimitWindow[];
  notes?: string[];
}

export interface OmpUsageSnapshot {
  /** Per-provider reports, keyed by lowercased provider id. */
  reports: Map<string, OmpUsageReportEntry>;
  /** Providers whose credentials produced no usage report at all. */
  accountsWithoutUsage: string[];
}

function emptySnapshot(): OmpUsageSnapshot {
  return { reports: new Map(), accountsWithoutUsage: [] };
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return items.length > 0 ? items : undefined;
}

/**
 * Resolve a limit's used fraction exactly as omp does: explicit `usedFraction`
 * first, then `used`/`limit`, then a percent-unit `used`, then an inverted
 * `remainingFraction`. Resolved here so the client never re-derives it.
 */
function resolveUsedFraction(amount: Record<string, unknown>): number | undefined {
  const usedFraction = toNumber(amount.usedFraction);
  if (usedFraction !== undefined) return usedFraction;
  const used = toNumber(amount.used);
  const limit = toNumber(amount.limit);
  if (used !== undefined && limit !== undefined && limit > 0) return used / limit;
  if (amount.unit === 'percent' && used !== undefined) return used / 100;
  const remainingFraction = toNumber(amount.remainingFraction);
  if (remainingFraction !== undefined) return Math.max(0, 1 - remainingFraction);
  return undefined;
}

function mapLimit(raw: unknown): UsageLimitWindow | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!id) return null;
  const amount = isRecord(raw.amount) ? raw.amount : {};
  const scope = isRecord(raw.scope) ? raw.scope : {};
  const window = isRecord(raw.window) ? raw.window : {};
  const unit = UNITS.find((candidate) => candidate === amount.unit) ?? 'unknown';
  const status = STATUSES.find((candidate) => candidate === raw.status) ?? 'unknown';
  const used = toNumber(amount.used);
  const limit = toNumber(amount.limit);
  const remaining = toNumber(amount.remaining);
  const usedFraction = resolveUsedFraction(amount);
  const resetsAt = toNumber(window.resetsAt);
  const notes = toStringArray(raw.notes);
  const windowId = typeof window.id === 'string' ? window.id : '';
  const modelId = typeof scope.modelId === 'string' ? scope.modelId : '';
  const accountId = typeof scope.accountId === 'string' ? scope.accountId : '';

  return {
    id,
    label: typeof raw.label === 'string' && raw.label ? raw.label : id,
    ...(windowId ? { windowLabel: windowId } : {}),
    ...(modelId ? { modelId } : {}),
    ...(accountId ? { accountId } : {}),
    ...(used !== undefined ? { used } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(remaining !== undefined ? { remaining } : {}),
    ...(usedFraction !== undefined ? { usedFraction } : {}),
    unit,
    status,
    ...(resetsAt !== undefined ? { resetsAt } : {}),
    ...(notes ? { notes } : {}),
  };
}

/** Fold the parsed CLI payload into a snapshot; unknown shapes degrade to empty. */
export function parseOmpUsageSnapshot(payload: unknown): OmpUsageSnapshot {
  if (!isRecord(payload)) return emptySnapshot();
  const snapshot = emptySnapshot();

  const reports = Array.isArray(payload.reports) ? payload.reports : [];
  for (const entry of reports) {
    if (!isRecord(entry)) continue;
    const provider = typeof entry.provider === 'string' ? entry.provider.trim().toLowerCase() : '';
    if (!provider) continue;
    const limits = (Array.isArray(entry.limits) ? entry.limits : [])
      .map(mapLimit)
      .filter((limit): limit is UsageLimitWindow => limit !== null);
    const existing = snapshot.reports.get(provider);
    // One provider can report several accounts; their limits are additive, and
    // the account id already travels on each limit.
    const merged: OmpUsageReportEntry = existing ?? { provider, limits: [] };
    merged.limits = [...merged.limits, ...limits];
    const notes = toStringArray(entry.notes);
    if (notes) merged.notes = [...(merged.notes ?? []), ...notes];
    snapshot.reports.set(provider, merged);
  }

  const withoutUsage = Array.isArray(payload.accountsWithoutUsage) ? payload.accountsWithoutUsage : [];
  for (const entry of withoutUsage) {
    const provider = isRecord(entry) && typeof entry.provider === 'string'
      ? entry.provider.trim().toLowerCase()
      : '';
    if (provider && !snapshot.accountsWithoutUsage.includes(provider)) {
      snapshot.accountsWithoutUsage.push(provider);
    }
  }
  return snapshot;
}

let cached: { at: number; data: OmpUsageSnapshot } | null = null;
let inFlight: Promise<OmpUsageSnapshot> | null = null;

/** Drop the cached snapshot so the next read spawns the current omp binary.
 *  Called when the standby processes are recycled after `omp update`: the
 *  snapshot was produced by the build that is no longer installed. */
export function invalidateUsageCache(): void {
  cached = null;
}

/**
 * Read (and cache) the provider usage snapshot. Never throws — an unusable
 * snapshot degrades to an empty one so the panel still shows local burn.
 *
 * `force` bypasses the TTL: the command calls every provider's endpoint, so a
 * cached read must be cheap, but the user's own Refresh button is entitled to
 * fresh numbers rather than a minute-old snapshot.
 */
export async function fetchOmpUsageSnapshot(options: { force?: boolean } = {}): Promise<OmpUsageSnapshot> {
  if (!options.force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const bin = resolveOmpBin();
    if (!bin) return emptySnapshot();
    try {
      const proc = Bun.spawn({
        env: childEnv(),
        cmd: [bin, 'usage', '--json'],
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES,
        windowsHide: true,
      });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      return parseOmpUsageSnapshot(JSON.parse(stdout));
    } catch {
      // no-excuse-ok: catch — a failed/timed-out/malformed probe is a soft miss
      return emptySnapshot();
    }
  })();

  try {
    const data = await inFlight;
    cached = { at: Date.now(), data };
    return data;
  } finally {
    inFlight = null;
  }
}
