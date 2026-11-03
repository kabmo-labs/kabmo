/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Folding ONE transcript line into usage counters, without touching disk.
 *
 * Everything here is pure so the arithmetic can be pinned exactly: a wrong
 * total only surfaces later as a bill disagreeing with the panel. The three
 * rules that used to be wrong or missing:
 *
 *  - **Provider attribution.** `message.provider` is written on every usage
 *    entry (measured: 0 of 143 969 records without it), yet the breakdown
 *    keyed on model alone, so two accounts serving `deepseek-v4-1-flash`
 *    reported one merged cost. The key is `(canonical provider, model)`.
 *  - **The day is LOCAL.** `timestamp.slice(0, 10)` is UTC, while "Today"
 *    means the reader's calendar day; a 00:30 WIB record landed in
 *    yesterday's chart column but in today's total.
 *  - **Explicit totals win.** `usage.totalTokens` (and `cost.total`) are
 *    omp's own numbers; the parts are only summed when absent.
 */

import { canonicalProviderSlug } from '@/shared/lib/models/provider/label';
import { dayKeyOfTimestamp } from '@/shared/lib/usage/range';
import type { OmpMessageEntry, OmpUsage } from '@/shared/types/omp/session';

/** One rollup contribution: a file's share of one (day, provider, model). */
export interface UsageRollupRow {
  day: string;
  provider: string;
  model: string;
  records: number;
  unpriced: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
  costTotal: number;
  costInput: number;
  costOutput: number;
  costCacheRead: number;
  costCacheWrite: number;
}

/** A parsed usage entry, before the file's project name is attached. */
export interface ParsedUsageEntry {
  day: string;
  provider: string;
  model: string;
  usage: OmpUsage;
}

/**
 * A cheap reject before `JSON.parse` — the same shape the previous scan used,
 * with a narrower filter.
 *
 * A session file is mostly tool output: on the measured tree, 144 365 of
 * 513 140 lines carry usage. `JSON.stringify` writes the `"usage"` key
 * verbatim, so a line without that literal cannot be a usage record. Testing
 * it first removed 80% of the parses and was measured at 493 ms → 281 ms on
 * the same tree.
 */
export function couldCarryUsage(raw: string): boolean {
  return raw.includes('"usage"');
}

/** Parse one line; `null` for a non-usage line, a torn write, or a non-message. */
export function parseUsageLine(raw: string): ParsedUsageEntry | null {
  if (!couldCarryUsage(raw)) return null;
  const line = raw.trim();
  if (!line) return null;
  let entry: OmpMessageEntry;
  try {
    entry = JSON.parse(line) as OmpMessageEntry;
  } catch {
    // Torn write / prefix-window truncation — the fold tolerates these too.
    return null;
  }
  const usage = entry.message?.usage;
  if (entry.type !== 'message' || !usage) return null;
  return {
    day: dayKeyOfTimestamp(entry.timestamp),
    provider: canonicalProviderSlug(entry.message?.provider || 'unknown') || 'unknown',
    model: entry.message?.model || 'unknown',
    usage,
  };
}

/** Accumulate one entry into a keyed map of rollup rows. */
export function foldUsage(
  rows: Map<string, UsageRollupRow>,
  project: string,
  entry: ParsedUsageEntry,
): void {
  const usage = entry.usage;
  const key = [entry.day, entry.provider, entry.model, project].join('\u0000');
  let row = rows.get(key);
  if (!row) {
    row = {
      day: entry.day,
      provider: entry.provider,
      model: entry.model,
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
  const input = usage.input ?? 0;
  const output = usage.output ?? 0;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const costTotal = usage.cost?.total ?? 0;
  row.records++;
  row.input += input;
  row.output += output;
  row.cacheRead += cacheRead;
  row.cacheWrite += cacheWrite;
  row.reasoning += usage.reasoningTokens ?? 0;
  row.total += usage.totalTokens ?? input + output + cacheRead + cacheWrite;
  row.costTotal += costTotal;
  row.costInput += usage.cost?.input ?? 0;
  row.costOutput += usage.cost?.output ?? 0;
  row.costCacheRead += usage.cost?.cacheRead ?? 0;
  row.costCacheWrite += usage.cost?.cacheWrite ?? 0;
  // "Unpriced" is a property of the RECORD: it carried tokens and no
  // provider-reported cost. Counting rows instead would report a whole
  // gateway as priced as soon as one entry had a rate.
  if (costTotal === 0 && input + output + cacheRead + cacheWrite > 0) row.unpriced++;
}

/**
 * Fold a chunk of transcript text into rows.
 *
 * `completeOnly` governs the last line: a caller reading the tail of a file
 * being written must drop a partial line, or the next scan would parse its
 * remainder as a new entry. A whole-file read keeps the last line, because a
 * file whose final newline was never flushed still has one valid entry.
 */
export function foldUsageText(
  rows: Map<string, UsageRollupRow>,
  project: string,
  text: string,
  completeOnly = false,
): void {
  const lines = text.split('\n');
  if (completeOnly) lines.pop();
  for (const raw of lines) {
    const entry = parseUsageLine(raw);
    if (entry) foldUsage(rows, project, entry);
  }
}

/**
 * The byte offset just past the last COMPLETE line of `text`.
 *
 * Only newlines matter: a tail read that stopped mid-line must resume from the
 * line's start, never from its middle (whose bytes would then be parsed as a
 * broken entry and lost forever). Multi-byte UTF-8 is safe because `\n` never
 * appears inside a sequence.
 */
export function completeLineOffset(text: string): number {
  const lastNewline = text.lastIndexOf('\n');
  return lastNewline < 0 ? 0 : lastNewline + 1;
}
