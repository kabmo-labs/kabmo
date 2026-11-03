/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The incremental scan behind the Token Usage panel.
 *
 * The panel's old cost model was "read the world, cache it for 60 seconds":
 * 1 227 transcripts / 1 580 MB, measured 3.8–8.0 s cold, and every Kabmo
 * restart or 60-second idle paid it again — inside the request that asked for
 * the panel. This module replaces it with an on-disk index:
 *
 *  - `usage_index_file` records how many bytes of each transcript are already
 *    folded, so an append costs a tail read instead of a whole-file parse;
 *  - `usage_rollup` holds the counters per (file, day, provider, model,
 *    project), which the payload query then `GROUP BY`s in milliseconds.
 *
 * A request never waits for a scan that is not the first: `ensureUsageIndex`
 * answers with the current state and starts a background pass, and the client
 * keeps showing the data it has (with a live "indexing…" line) until the next
 * poll reports `ready`.
 *
 * Every file write is one transaction with a compare-and-swap on the row it
 * read: a second Kabmo on another port indexing the same tree loses the swap
 * rather than double-counting the same bytes.
 */

import fs from 'node:fs';
import { join } from 'node:path';

import { getDb } from '@/server/db.server';
import type { DbClient } from '@/server/lib/db/client';
import { getSessionsDir } from '@/server/lib/omp/core/paths';
import { completeLineOffset, foldUsageText, type UsageRollupRow } from '@/server/lib/usage/index-parse';
import type { UsageIndexState } from '@/shared/types';

/** Re-check the tree at most this often; the walk is a stat pass (~200 ms). */
const INDEX_TTL_MS = 20_000;
/** A transcript larger than this is not a session we can fold cheaply. */
const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;
/** Yield to the event loop this often while scanning. */
const YIELD_EVERY = 20;

interface IndexHost {
  inFlight: Promise<void> | null;
  lastCheck: number;
  state: UsageIndexState;
}

const globalKey = '__kabmoUsageIndex';

function host(): IndexHost {
  const slot = globalThis as typeof globalThis & { [globalKey]?: IndexHost };
  slot[globalKey] ??= {
    inFlight: null,
    lastCheck: 0,
    state: { state: 'ready', transcripts: 0, records: 0, indexedAt: 0, scanMs: 0 },
  };
  return slot[globalKey];
}

interface FileStateRow {
  session_file: string;
  offset: number;
  size: number;
  mtime_ms: number;
}

interface ScannedFile {
  path: string;
  project: string;
  size: number;
  mtimeMs: number;
}

/** Every transcript under the sessions root, with the project folder it lives in. */
async function listTranscripts(root: string): Promise<ScannedFile[]> {
  const out: ScannedFile[] = [];
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const projectPath = join(root, entry.name);
    if (entry.isFile()) {
      // A transcript written directly under the sessions root still belongs to
      // a project: its own name is the only one it has.
      if (!entry.name.endsWith('.jsonl')) continue;
      const stat = await safeStat(projectPath);
      if (stat) out.push({ path: projectPath, project: entry.name, ...stat });
      continue;
    }
    if (!entry.isDirectory()) continue;
    let names: string[];
    try {
      names = await fs.promises.readdir(projectPath);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const path = join(projectPath, name);
      const stat = await safeStat(path);
      if (stat) out.push({ path, project: entry.name, ...stat });
    }
  }
  return out;
}

async function safeStat(path: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const stat = await fs.promises.stat(path);
    return stat.isFile() ? { size: stat.size, mtimeMs: stat.mtimeMs } : null;
  } catch {
    return null;
  }
}

const ROLLUP_COLUMNS = [
  'session_file', 'day', 'provider', 'model', 'project', 'records', 'unpriced',
  'input', 'output', 'cache_read', 'cache_write', 'reasoning', 'total',
  'cost_total', 'cost_input', 'cost_output', 'cost_cache_read', 'cost_cache_write',
] as const;

const INSERT_SET = ROLLUP_COLUMNS.slice(5).map((column) => `${column} = ${column} + excluded.${column}`).join(', ');

/**
 * Write one file's contribution.
 *
 * `append` accumulates onto the rows already stored for that file (a tail read
 * holds only NEW entries); a full read replaces them, which is also how a
 * truncated or rewritten transcript stops contributing its old numbers.
 *
 * Returns false when another writer won the swap — the caller then leaves the
 * file alone rather than folding the same bytes twice.
 */
async function commitFile(
  file: ScannedFile,
  rows: Map<string, UsageRollupRow>,
  previous: FileStateRow | null,
  nextOffset: number,
  append: boolean,
): Promise<boolean> {
  const db = await getDb();
  const values = [...rows.values()];
  const insertSql = append
    ? `INSERT INTO usage_rollup (${ROLLUP_COLUMNS.join(', ')}) VALUES (${ROLLUP_COLUMNS.map(() => '?').join(', ')})
       ON CONFLICT(session_file, day, provider, model, project) DO UPDATE SET ${INSERT_SET}`
    : `INSERT OR REPLACE INTO usage_rollup (${ROLLUP_COLUMNS.join(', ')}) VALUES (${ROLLUP_COLUMNS.map(() => '?').join(', ')})`;

  return db.raw.transaction(() => {
    let claimed: number;
    if (previous) {
      const claim = db.raw.query(
        'UPDATE usage_index_file SET offset = ?, size = ?, mtime_ms = ?, indexed_at = ? WHERE session_file = ? AND offset = ? AND size = ?',
      ).run(nextOffset, file.size, file.mtimeMs, Date.now(), file.path, previous.offset, previous.size);
      claimed = claim.changes;
    } else {
      const claim = db.raw.query(
        'INSERT INTO usage_index_file (session_file, offset, size, mtime_ms, indexed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_file) DO NOTHING',
      ).run(file.path, nextOffset, file.size, file.mtimeMs, Date.now());
      claimed = claim.changes;
    }
    if (claimed === 0) return false;
    if (!append) db.raw.query('DELETE FROM usage_rollup WHERE session_file = ?').run(file.path);
    const insert = db.raw.query(insertSql);
    for (const row of values) {
      insert.run(
        file.path, row.day, row.provider, row.model, file.project, row.records, row.unpriced,
        row.input, row.output, row.cacheRead, row.cacheWrite, row.reasoning, row.total,
        row.costTotal, row.costInput, row.costOutput, row.costCacheRead, row.costCacheWrite,
      );
    }
    return true;
  })();
}

/** Fold one transcript, reading only what has been appended since the last pass. */
async function indexFile(file: ScannedFile, previous: FileStateRow | null): Promise<'skipped' | 'full' | 'append' | 'lost'> {
  const rows = new Map<string, UsageRollupRow>();

  if (file.size > MAX_TRANSCRIPT_BYTES) return 'skipped';

  // Unchanged: nothing to read. mtime is part of the key because a file can be
  // rewritten with the same length (a rotated session, an in-place repair).
  if (previous && previous.size === file.size && previous.mtime_ms === file.mtimeMs) return 'skipped';

  let text: string;
  let append = false;
  let baseOffset = 0;
  // A tail read is only safe once the index has seen the WHOLE file: a row
  // written by an older build may have counted a file the old way, and adding
  // to it would mix two attributions. Starting from 0 also means a truncated
  // or rewritten transcript is rebuilt rather than patched.
  const canAppend = previous !== null && previous.offset > 0 && previous.size === previous.offset;
  try {
    if (previous && canAppend && file.size > previous.size) {
      // Only the appended bytes: the tick between two scans is usually a few
      // lines, not the 11 MB the whole file would cost.
      text = await Bun.file(file.path).slice(previous.size, file.size).text();
      baseOffset = previous.size;
      append = true;
    } else {
      text = await Bun.file(file.path).text();
    }
  } catch {
    return 'skipped';
  }

  // A tail read can stop mid-line; keep only whole lines so the next pass
  // resumes at a boundary instead of re-parsing half an entry.
  foldUsageText(rows, file.project, text, append);
  const nextOffset = baseOffset + completeLineOffset(text);

  const won = await commitFile(file, rows, previous, nextOffset, append);
  if (!won) return 'lost';
  return append ? 'append' : 'full';
}

/** One full pass over the tree. Returns the state it leaves behind. */
async function scanOnce(): Promise<UsageIndexState> {
  const startedAt = Date.now();
  const db = await getDb();
  const existing = await db.all<FileStateRow>('SELECT session_file, offset, size, mtime_ms FROM usage_index_file');
  const known = new Map(existing.map((row) => [row.session_file, row]));

  let failed: string | undefined;
  let visited = 0;
  try {
    const transcripts = await listTranscripts(getSessionsDir());
    // A removed or pruned session must stop contributing: its rollup rows
    // would otherwise keep costing money on a panel that no longer has the
    // transcript they came from.
    const present = new Set(transcripts.map((file) => file.path));
    for (const stale of [...known.keys()]) {
      if (present.has(stale)) continue;
      await db.raw.query('DELETE FROM usage_rollup WHERE session_file = ?').run(stale);
      await db.raw.query('DELETE FROM usage_index_file WHERE session_file = ?').run(stale);
    }
    for (const file of transcripts) {
      visited++;
      try {
        await indexFile(file, known.get(file.path) ?? null);
      } catch (error) {
        // One unreadable transcript must not fail the report; the index keeps
        // whatever it already had for it.
        failed ??= error instanceof Error ? error.message : String(error);
      }
      if (visited % YIELD_EVERY === 0) await Bun.sleep(0);
    }
  } catch (error) {
    failed = error instanceof Error ? error.message : String(error);
  }

  const totals = await db.get<{ records: number | null; transcripts: number }>(
    'SELECT (SELECT SUM(records) FROM usage_rollup) AS records, (SELECT COUNT(*) FROM usage_index_file) AS transcripts',
  );
  const state: UsageIndexState = {
    state: failed ? 'failed' : 'ready',
    transcripts: totals?.transcripts ?? 0,
    records: totals?.records ?? 0,
    indexedAt: Date.now(),
    scanMs: Date.now() - startedAt,
    ...(failed ? { error: failed } : {}),
  };
  host().state = state;
  return state;
}

/**
 * Bring the index up to date as far as this request is allowed to.
 *
 * The FIRST request waits (there is no data to draw yet). Every later one
 * starts a background pass and answers immediately — the panel polls while
 * `state` is `building`, so a slow disk shows progress instead of a spinner.
 */
export async function ensureUsageIndex(options: { wait?: boolean; force?: boolean } = {}): Promise<UsageIndexState> {
  const state = host();
  const db = await getDb();
  const meta = await db.get<{ value: string }>('SELECT value FROM usage_index_meta WHERE key = ?', ['indexed_at']);
  const lastIndexedAt = meta ? Number(meta.value) : 0;

  // A fresh process starts with no in-memory counters, while the index on disk
  // may be complete. Hydrate before answering, or the first request after a
  // restart would report "0 transcripts" beside a fully populated table.
  if (state.state.indexedAt === 0 && lastIndexedAt > 0) {
    const counts = await readCounts(db);
    const scanMs = await db.get<{ value: string }>('SELECT value FROM usage_index_meta WHERE key = ?', ['scan_ms']);
    state.state = {
      state: 'ready',
      ...counts,
      indexedAt: lastIndexedAt,
      scanMs: Number(scanMs?.value ?? 0),
    };
  }

  if (state.inFlight) return options.wait ? await settle(state) : state.state;
  // `force` is the user's own Refresh: it accepts the stat pass now rather
  // than waiting out the TTL.
  if (!options.force && lastIndexedAt > 0 && Date.now() - state.lastCheck < INDEX_TTL_MS) return state.state;

  state.lastCheck = Date.now();
  const run = scanOnce()
    .catch((error: unknown) => {
      state.state = {
        ...state.state,
        state: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
      return state.state;
    })
    .then(async (result) => {
      const handle = await getDb();
      await handle.run('INSERT OR REPLACE INTO usage_index_meta (key, value) VALUES (?, ?)', ['indexed_at', String(result.indexedAt)]);
      await handle.run('INSERT OR REPLACE INTO usage_index_meta (key, value) VALUES (?, ?)', ['scan_ms', String(result.scanMs)]);
      state.inFlight = null;
    });
  state.inFlight = run;
  state.state = { ...state.state, state: 'building' };

  if (lastIndexedAt === 0 || options.wait) return await settle(state);
  return state.state;
}

async function readCounts(db: DbClient): Promise<{ transcripts: number; records: number }> {
  const totals = await db.get<{ records: number | null; transcripts: number }>(
    'SELECT (SELECT SUM(records) FROM usage_rollup) AS records, (SELECT COUNT(*) FROM usage_index_file) AS transcripts',
  );
  return { transcripts: totals?.transcripts ?? 0, records: totals?.records ?? 0 };
}

async function settle(state: IndexHost): Promise<UsageIndexState> {
  await state.inFlight;
  return state.state;
}

/** The index's current state without touching the disk. */
export function currentUsageIndexState(): UsageIndexState {
  return host().state;
}
