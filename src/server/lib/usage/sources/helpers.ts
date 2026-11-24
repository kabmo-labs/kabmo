/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared arithmetic for the ACP harness sources.
 *
 * Every source converts its own file format into `ParsedUsageEntry` and folds it
 * through the SAME `foldUsage` the omp transcript uses. That is what keeps the
 * unpriced rule, the provider alias fold and the per-turn totals in one place:
 * a second counter implementation is how one harness reports "free" and another
 * "unpriced" for the same absence of a rate.
 */

import fs from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import type { HarnessId } from '@/shared/lib/harness/catalog';
import { localDayKey } from '@/shared/lib/usage/range';
import { foldUsage, type ParsedUsageEntry, type UsageRollupRow } from '@/server/lib/usage/index-parse';

/**
 * The root every ACP store lives under.
 *
 * Production reads the user's home. The test preload points this at a temp
 * directory so a unit suite can never fold the developer's real harness
 * history — the same reason the sessions root is redirected.
 */
export function acpRoot(): string {
  return Bun.env.KABMO_USAGE_ACP_ROOT?.trim() || homedir();
}

/** A store under `acpRoot`, unless its own override names the directory. */
export function storeHome(env: string, relative: string): string {
  return Bun.env[env]?.trim() || join(acpRoot(), relative);
}

/** A cwd's last segment, for the project column. */
export function projectFromCwd(cwd: unknown): string {
  if (typeof cwd !== 'string' || !cwd.trim()) return '';
  return basename(cwd.trim());
}

/** A stat result a store may not have; `null` means "not there". */
export async function statOrNull(path: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const stat = await fs.promises.stat(path);
    return stat.isFile() ? { size: stat.size, mtimeMs: stat.mtimeMs } : null;
  } catch {
    return null;
  }
}

/** Directory entries, or [] when the directory is absent. */
export async function readdirOrEmpty(path: string): Promise<fs.Dirent[]> {
  try {
    return await fs.promises.readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** A directory's names, or [] when it is absent. */
export async function names(path: string): Promise<string[]> {
  try {
    return await fs.promises.readdir(path);
  } catch {
    return [];
  }
}

/** The local calendar day of an epoch-ms clock, or `''`. */
export function dayOfMs(ms: unknown): string {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? localDayKey(ms) : '';
}

/** The local calendar day of an ISO timestamp, or `''`. */
export function dayOfIso(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '' : localDayKey(ms);
}

/** A non-negative token counter from an unknown field. */
export function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** A non-negative USD amount from an unknown field. */
export function costOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export interface UsageNumbers {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  total?: number;
  cost?: number;
}

/** Fold one parsed harness record through the shared counter. */
export function addUsage(
  rows: Map<string, UsageRollupRow>,
  options: {
    project: string;
    harness: HarnessId;
    provider: string;
    model: string;
    day: string;
    usage: UsageNumbers;
  },
): void {
  const entry: ParsedUsageEntry = {
    day: options.day,
    harness: options.harness,
    provider: options.provider,
    model: options.model,
    usage: {
      input: options.usage.input ?? 0,
      output: options.usage.output ?? 0,
      cacheRead: options.usage.cacheRead ?? 0,
      cacheWrite: options.usage.cacheWrite ?? 0,
      reasoningTokens: options.usage.reasoning ?? 0,
      totalTokens: options.usage.total,
      cost: { total: options.usage.cost ?? 0 },
    },
  };
  foldUsage(rows, options.project, entry);
}

/**
 * Add a session-reported cost without inventing a turn.
 *
 * `foldUsage` increments `records`; a `cost-state` row is a session TOTAL, not a
 * turn, so counting it as one would make the panel's turn count wrong by one
 * per Claude session.
 */
export function addCostOnly(
  rows: Map<string, UsageRollupRow>,
  options: {
    project: string;
    harness: HarnessId;
    provider: string;
    model: string;
    day: string;
    cost: number;
  },
): void {
  if (options.cost <= 0) return;
  const key = [options.day, options.harness, options.provider, options.model, options.project].join('\u0000');
  let row = rows.get(key);
  if (!row) {
    row = {
      day: options.day,
      harness: options.harness,
      provider: options.provider,
      model: options.model,
      project: options.project,
      records: 0,
      unpriced: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 0,
      costTotal: 0,
      costInput: 0,
      costOutput: 0,
      costCacheRead: 0,
      costCacheWrite: 0,
    };
    rows.set(key, row);
  }
  row.costTotal += options.cost;
}

/** `true` when the record carries no tokens and no cost. */
export function isEmptyUsage(usage: UsageNumbers): boolean {
  return !usage.input && !usage.output && !usage.cacheRead && !usage.cacheWrite && !usage.reasoning && !usage.cost;
}

/** The provider a store reports, falling back to the harness that wrote it. */
export function providerFor(harness: HarnessId, provider: unknown): string {
  return typeof provider === 'string' && provider.trim() ? provider.trim() : harness;
}
