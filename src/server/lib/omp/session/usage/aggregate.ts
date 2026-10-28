/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Real token/cost usage aggregation from oh-my-pi session files
 * (~/.omp/agent/sessions/<project>/*.jsonl). Faithful to the omp session
 * format parsed by lib/omp/session (usage blocks with input/output/cache/
 * reasoning tokens and per-message cost). Powers /api/telemetry/tokens in
 * real mode so telemetry reflects actual omp activity instead of zeros.
 */

import fs from 'fs';
import { join } from 'path';
import { getSessionsDir } from '@/server/lib/omp/core/paths';
import type { TimeRangeType } from '@/shared/types';
import type { OmpMessageEntry, OmpUsage } from '@/shared/types/omp/session';

export type UsageWindow =
  | { kind: 'preset'; range: Exclude<TimeRangeType, 'custom'> }
  | { kind: 'custom'; from: string; to: string }
  | { kind: 'all' };

const PRESET_DAYS: Record<Exclude<TimeRangeType, 'custom' | 'all' | 'today'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

/** Every range the tokens endpoint reports, in display order. */
export const PRESET_RANGES: Exclude<TimeRangeType, 'custom'>[] = ['today', '7d', '30d', '90d', 'all'];

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; data: UsageAggregate }>();

export interface UsageAggregate {
  scannedTranscripts: number;
  usageRecords: number;
  costTotal: number;
  costInput: number;
  costOutput: number;
  costCacheRead: number;
  costCacheWrite: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  activeDays: Set<string>;
  byModel: Map<string, { tokens: number; cost: number }>;
  byDay: Map<string, { tokens: number; cost: number }>;
  byProject: Map<string, { tokens: number; cost: number }>;
}

function emptyAggregate(): UsageAggregate {
  return {
    scannedTranscripts: 0,
    usageRecords: 0,
    costTotal: 0,
    costInput: 0,
    costOutput: 0,
    costCacheRead: 0,
    costCacheWrite: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    activeDays: new Set(),
    byModel: new Map(),
    byDay: new Map(),
    byProject: new Map(),
  };
}

function bump(map: Map<string, { tokens: number; cost: number }>, key: string, tokens: number, cost: number): void {
  const current = map.get(key) ?? { tokens: 0, cost: 0 };
  current.tokens += tokens;
  current.cost += cost;
  map.set(key, current);
}

function cacheKey(window: UsageWindow): string {
  if (window.kind === 'all') return 'all';
  if (window.kind === 'custom') return `custom:${window.from}:${window.to}`;
  return window.range;
}

/**
 * One usage record, with everything a window needs to decide whether it counts.
 *
 * The scan that produces these is the expensive part — measured 795 ms over 455
 * transcripts / 327 MB — so it runs ONCE and every window is derived from the
 * same array. Aggregating per window re-read the whole tree for each of the five
 * presets plus the active window, which is why `/api/telemetry/tokens` took
 * 3.3 s cold.
 */
interface UsageRecord {
  /** Epoch ms of the entry's timestamp, or undefined when it has none. */
  at: number | undefined;
  /** `YYYY-MM-DD` of `at`, or undefined. */
  day: string | undefined;
  model: string;
  project: string;
  cost: number;
  costInput: number;
  costOutput: number;
  costCacheRead: number;
  costCacheWrite: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
}

interface UsageScan {
  at: number;
  records: UsageRecord[];
  /** Transcripts visited, counted once for every window. */
  scannedTranscripts: number;
}

let scanCache: UsageScan | null = null;

/** A session entry narrowed to the one shape the scan folds. */
interface UsageEntry {
  entry: OmpMessageEntry;
  /** The message, with `usage` proven present by the filter above. */
  message: { usage: OmpUsage; model?: string };
}

/**
 * The `usage` blocks in one transcript, without parsing the entries that carry
 * none.
 *
 * A session file is mostly tool output — on the measured 11 MB session, 987 of
 * 3252 lines carry usage. `JSON.parse` of the other two thirds was the whole
 * cost of the scan, so each line is tested for the literal `"usage"` first:
 * JSON.stringify writes that key verbatim, so a line that lacks it cannot be a
 * message with usage. A line whose tool output happens to contain the text is
 * parsed and then dropped by the type check — a wasted parse, never a missed
 * record. Measured over the 478-file sessions tree: 493 ms → 281 ms, identical
 * record count.
 */
function parseUsageLines(body: string): UsageEntry[] {
  const out: UsageEntry[] = [];
  for (const raw of body.split('\n')) {
    if (!raw.includes('"usage"')) continue;
    const line = raw.trim();
    if (!line) continue;
    try {
      const entry = JSON.parse(line) as OmpMessageEntry;
      const message = entry.message;
      if (entry.type === 'message' && message?.usage) out.push({ entry, message: { usage: message.usage, model: message.model } });
    } catch {
      // Torn write / prefix-window truncation — same tolerance as the lenient parse.
    }
  }
  return out;
}

/** Every usage record in the sessions tree, read at most once per TTL. */
async function scanUsage(): Promise<UsageScan> {
  if (scanCache && Date.now() - scanCache.at < TTL_MS) return scanCache;

  const sessionsRoot = getSessionsDir();
  const records: UsageRecord[] = [];
  let scannedTranscripts = 0;
  let projectDirs: string[] = [];
  try {
    projectDirs = (await fs.promises.readdir(sessionsRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory() || d.isFile())
      .map((d) => d.name);
  } catch {
    scanCache = { at: Date.now(), records, scannedTranscripts };
    return scanCache;
  }

  for (const project of projectDirs) {
    const projectPath = join(sessionsRoot, project);
    let files: string[] = [];
    try {
      if ((await Bun.file(projectPath).stat()).isFile()) {
        files = project.endsWith('.jsonl') ? [projectPath] : [];
      } else {
        files = (await fs.promises.readdir(projectPath))
          .filter((f) => f.endsWith('.jsonl'))
          .map((f) => join(projectPath, f));
      }
    } catch {
      continue;
    }

    for (const file of files) {
      scannedTranscripts++;
      try {
        const ufile = Bun.file(file);
        if ((await ufile.stat()).size > 64 * 1024 * 1024) continue;
        for (const { entry, message } of parseUsageLines(await ufile.text())) {
          const usage = message.usage;
          const ts = entry.timestamp;
          const parsed = ts ? Date.parse(ts) : Number.NaN;
          records.push({
            at: Number.isNaN(parsed) ? undefined : parsed,
            day: ts ? ts.slice(0, 10) : undefined,
            model: message.model || 'unknown',
            project,
            cost: usage.cost?.total ?? 0,
            costInput: usage.cost?.input ?? 0,
            costOutput: usage.cost?.output ?? 0,
            costCacheRead: usage.cost?.cacheRead ?? 0,
            costCacheWrite: usage.cost?.cacheWrite ?? 0,
            input: usage.input ?? 0,
            output: usage.output ?? 0,
            cacheRead: usage.cacheRead ?? 0,
            cacheWrite: usage.cacheWrite ?? 0,
            reasoning: usage.reasoningTokens ?? 0,
            total: usage.totalTokens ?? (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0),
          });
        }
      } catch {
        // Unreadable transcript — skip rather than failing the whole report.
      }
    }
  }

  scanCache = { at: Date.now(), records, scannedTranscripts };
  return scanCache;
}

/** Fold the scanned records that fall inside `window` into an aggregate. */
function foldWindow(records: readonly UsageRecord[], window: UsageWindow, now: number, scannedTranscripts: number): UsageAggregate {
  const aggregate = emptyAggregate();
  aggregate.scannedTranscripts = scannedTranscripts;
  const bounds = windowBounds(window, now);
  for (const record of records) {
    // An entry with no usable timestamp is kept by EVERY window — a missing
    // date is not evidence of age, and this matches the previous per-record
    // behaviour.
    if (record.at !== undefined && (record.at < bounds.from || record.at > bounds.to)) continue;
    aggregate.usageRecords++;
    aggregate.costTotal += record.cost;
    aggregate.costInput += record.costInput;
    aggregate.costOutput += record.costOutput;
    aggregate.costCacheRead += record.costCacheRead;
    aggregate.costCacheWrite += record.costCacheWrite;
    aggregate.inputTokens += record.input;
    aggregate.outputTokens += record.output;
    aggregate.cacheReadTokens += record.cacheRead;
    aggregate.cacheWriteTokens += record.cacheWrite;
    aggregate.reasoningTokens += record.reasoning;
    if (record.day) {
      aggregate.activeDays.add(record.day);
      bump(aggregate.byDay, record.day, record.total, record.cost);
    }
    bump(aggregate.byModel, record.model, record.total, record.cost);
    bump(aggregate.byProject, record.project, record.total, record.cost);
  }
  return aggregate;
}

interface WindowBounds {
  /** Inclusive epoch-ms bounds; `-Infinity`/`Infinity` for an unbounded side. */
  from: number;
  to: number;
}

/**
 * Epoch-ms bounds for a window, computed once per fold.
 *
 * `today` is a local CALENDAR day (`setHours(0,0,0,0)`), not "the last 24h":
 * the panel's "today" tab counts the day the user is in, and the previous
 * implementation compared year/month/date for the same reason.
 */
function windowBounds(window: UsageWindow, now: number): WindowBounds {
  if (window.kind === 'custom') {
    const from = Date.parse(`${window.from}T00:00:00`);
    const to = Date.parse(`${window.to}T23:59:59.999`);
    if (Number.isNaN(from) || Number.isNaN(to) || from > to) return { from: -Infinity, to: Infinity };
    return { from, to };
  }
  if (window.kind === 'all') return { from: -Infinity, to: Infinity };
  switch (window.range) {
    case 'all':
      return { from: -Infinity, to: Infinity };
    case 'today': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { from: start.getTime(), to: end.getTime() - 1 };
    }
    default:
      return { from: now - PRESET_DAYS[window.range] * 24 * 60 * 60 * 1000, to: Infinity };
  }
}

/** Aggregate all omp session files within a time window. Cached for 60s. */
export async function aggregateUsage(window: UsageWindow): Promise<UsageAggregate> {
  const key = cacheKey(window);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

  const scan = await scanUsage();
  const data = foldWindow(scan.records, window, Date.now(), scan.scannedTranscripts);
  if (cache.size > 20) cache.clear();
  cache.set(key, { at: Date.now(), data });
  return data;
}

/**
 * Aggregate EVERY preset range plus `window` from one scan.
 *
 * The tokens endpoint needs all six, and folding them from one scan costs the
 * fold (linear in records) rather than six more tree reads.
 */
export async function aggregateUsageWindows(
  window: UsageWindow,
): Promise<{ ranges: Record<Exclude<TimeRangeType, 'custom'>, UsageAggregate>; active: UsageAggregate }> {
  const scan = await scanUsage();
  const now = Date.now();
  const ranges = {} as Record<Exclude<TimeRangeType, 'custom'>, UsageAggregate>;
  for (const range of PRESET_RANGES) {
    ranges[range] = foldWindow(scan.records, { kind: 'preset', range }, now, scan.scannedTranscripts);
  }
  const active = foldWindow(scan.records, window, now, scan.scannedTranscripts);
  // Cache each fold under its own key so a later single-window call reuses it.
  for (const range of PRESET_RANGES) cache.set(range, { at: now, data: ranges[range] });
  cache.set(cacheKey(window), { at: now, data: active });
  return { ranges, active };
}
