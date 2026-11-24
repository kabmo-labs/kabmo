/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The incremental scan behind the Token Usage panel.
 *
 * Every harness that records usage locally is a SOURCE (`sources/*`). omp writes
 * an append-only JSONL transcript, so its source reads only the appended tail;
 * the ACP harnesses keep SQLite files, zstd JSONL and monthly logs, which are
 * replaced whole when their stat changes. Either way the rows land in
 * `usage_rollup` and a period is a `GROUP BY`, not a store scan.
 *
 * A request never waits for a scan that is not the first: `ensureUsageIndex`
 * answers with the current state and starts a background pass, and the client
 * keeps showing the data it has (with a live "indexing..." line) until the next
 * poll reports `ready`.
 *
 * Every file write is one transaction with a compare-and-swap on the row it
 * read: a second Kabmo on another port indexing the same tree loses the swap
 * rather than double-counting the same bytes.
 */

import { getDb } from '@/server/db.server';
import type { DbClient } from '@/server/lib/db/client';
import { usageSources } from '@/server/lib/usage/index-sources.server';
import type { UsageFileState, UsageSourceFile, UsageSourceRead } from '@/server/lib/usage/sources/types';
import type { UsageIndexState } from '@/shared/types';

/** Re-check the stores at most this often; the walk is a stat pass. */
const INDEX_TTL_MS = 20_000;
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

const ROLLUP_COLUMNS = [
  'session_file', 'day', 'harness', 'provider', 'model', 'project', 'records', 'unpriced',
  'input', 'output', 'cache_read', 'cache_write', 'reasoning', 'total',
  'cost_total', 'cost_input', 'cost_output', 'cost_cache_read', 'cost_cache_write',
] as const;

const INSERT_SET = ROLLUP_COLUMNS.slice(6).map((column) => `${column} = ${column} + excluded.${column}`).join(', ');

/**
 * Write one file's contribution.
 *
 * `append` accumulates onto the rows already stored for that file (a tail read
 * holds only NEW entries); a full read replaces them, which is also how a
 * rewritten transcript or a migrated SQLite row stops contributing its old
 * numbers.
 *
 * Returns false when another writer won the swap — the caller then leaves the
 * file alone rather than folding the same bytes twice.
 */
async function commitFile(
  source: string,
  file: UsageSourceFile,
  read: UsageSourceRead,
  previous: UsageFileState | null,
): Promise<boolean> {
  const db = await getDb();
  const values = [...read.rows.values()];
  const insertSql = read.append
    ? `INSERT INTO usage_rollup (${ROLLUP_COLUMNS.join(', ')}) VALUES (${ROLLUP_COLUMNS.map(() => '?').join(', ')})
       ON CONFLICT(session_file, day, harness, provider, model, project) DO UPDATE SET ${INSERT_SET}`
    : `INSERT OR REPLACE INTO usage_rollup (${ROLLUP_COLUMNS.join(', ')}) VALUES (${ROLLUP_COLUMNS.map(() => '?').join(', ')})`;

  return db.raw.transaction(() => {
    let claimed: number;
    if (previous) {
      const claim = db.raw.query(
        `UPDATE usage_index_file SET offset = ?, size = ?, mtime_ms = ?, indexed_at = ?
          WHERE session_file = ? AND offset = ? AND size = ?`,
      ).run(read.nextOffset, file.size, file.mtimeMs, Date.now(), file.key, previous.offset, previous.size);
      claimed = claim.changes;
    } else {
      const claim = db.raw.query(
        `INSERT INTO usage_index_file (session_file, source, harness, offset, size, mtime_ms, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_file) DO NOTHING`,
      ).run(file.key, source, file.harness, read.nextOffset, file.size, file.mtimeMs, Date.now());
      claimed = claim.changes;
    }
    if (claimed === 0) return false;
    if (!read.append) db.raw.query('DELETE FROM usage_rollup WHERE session_file = ?').run(file.key);
    const insert = db.raw.query(insertSql);
    for (const row of values) {
      insert.run(
        file.key, row.day, row.harness, row.provider, row.model, row.project, row.records, row.unpriced,
        row.input, row.output, row.cacheRead, row.cacheWrite, row.reasoning, row.total,
        row.costTotal, row.costInput, row.costOutput, row.costCacheRead, row.costCacheWrite,
      );
    }
    return true;
  })();
}

/** One full pass over every store. Returns the state it leaves behind. */
async function scanOnce(): Promise<UsageIndexState> {
  const startedAt = Date.now();
  const db = await getDb();
  const existing = await db.all<UsageFileState>(
    'SELECT session_file, source, harness, offset, size, mtime_ms FROM usage_index_file',
  );
  const known = new Map(existing.map((row) => [row.session_file, row]));

  let failed: string | undefined;
  let visited = 0;
  try {
    const batches = await Promise.all(usageSources().map(async (source) => ({
      source,
      files: await source.list(),
    })));
    // A removed store or pruned session must stop contributing: its rollup rows
    // would otherwise keep costing money on a panel with no transcript behind
    // them. `present` is built from every store BEFORE any file is folded, so a
    // single unreadable file cannot hide the rest.
    const present = new Set(batches.flatMap((batch) => batch.files.map((file) => file.key)));
    for (const stale of [...known.keys()]) {
      if (present.has(stale)) continue;
      await db.raw.query('DELETE FROM usage_rollup WHERE session_file = ?').run(stale);
      await db.raw.query('DELETE FROM usage_index_file WHERE session_file = ?').run(stale);
    }

    for (const { source, files } of batches) {
      for (const file of files) {
        visited++;
        const previous = known.get(file.key) ?? null;
        // Unchanged: nothing to read. mtime is part of the key because a file
        // can be rewritten with the same length (a rotated session, a compacted
        // database).
        // The stat is not enough when the attribution changed underneath an
        // unchanged file: an omp transcript first indexed as `omp-rpc` and later
        // given a `harness_sessions` row must be re-folded, or the filter keeps
        // showing the old harness forever.
        if (
          previous
          && previous.size === file.size
          && previous.mtime_ms === file.mtimeMs
          && previous.harness === file.harness
        ) continue;
        try {
          const read = await source.read(file, previous);
          if (read) await commitFile(source.id, file, read, previous);
        } catch (error) {
          // One unreadable store must not fail the report; the index keeps
          // whatever it already had for it.
          failed ??= error instanceof Error ? error.message : String(error);
        }
        if (visited % YIELD_EVERY === 0) await Bun.sleep(0);
      }
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
