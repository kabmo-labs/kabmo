import { Database } from 'bun:sqlite';

/**
 * `bun:sqlite` compatibility client. The promise surface mirrors the retired
 * `sqlite` package so the 38 existing consumers keep compiling unchanged, and
 * the `T = any` defaults match that package's own signatures.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface DbClient {
  get<T = any>(sql: string, params?: any[]): Promise<T | undefined>;
  all<T = any>(sql: string, params?: any[]): Promise<T[]>;
  run(sql: string, params?: any[]): Promise<{ changes: number; lastID: number }>;
  /**
   * Run one statement for every parameter row, in transactions of `chunkSize`.
   *
   * Autocommit costs an fsync per statement: measured on this machine, 8 µs per
   * INSERT at `synchronous=NORMAL` against 0.20 µs inside a transaction — a 40x
   * difference that a loop of single-row writes pays in full. Chunking
   * rather than one transaction keeps the event-loop block bounded, because
   * `bun:sqlite` is synchronous and a 173 MB rewrite in one transaction would
   * freeze every request, stream and terminal frame for its whole duration.
   */
  writeMany(sql: string, paramsList: readonly any[][], chunkSize?: number): Promise<number>;
  exec(sql: string): Promise<void>;
  raw: Database;
}

/**
 * Open a database and return the compatibility client.
 *
 * Statements are prepared once and cached: `bun:sqlite` statements are
 * reusable, and the app issues thousands of small queries per request cycle
 * (sidebar scans, telemetry probes, file listings).
 */
/**
 * How long a blocked write waits for another connection to release the lock.
 *
 * The Kabmo database is shared: a second Kabmo on another port writes the
 * same file, the CLI writes it, and a maintenance `VACUUM` takes the exclusive
 * lock outright. Without this, a write that meets any of them fails on the spot
 * with `SQLITE_BUSY: database is locked` — which is exactly what a server log
 * from 2026-09-25 is full of, with no writer at fault.
 *
 * Deliberately modest: `bun:sqlite` is synchronous, so this wait blocks the
 * whole event loop — every request, stream and terminal frame with it. Two
 * seconds clears every realistic holder (a full `VACUUM` of this database
 * measured 134 ms) without freezing the app for long when a lock is stuck.
 */
const BUSY_TIMEOUT_MS = 2000;

export function createDb(path: string): DbClient {
  const raw = new Database(path, { create: true });
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  // WAL's documented pairing. `bun:sqlite` leaves SQLite's default at FULL,
  // which fsyncs on every commit: measured here, 79 µs per single-row INSERT
  // against 8 µs at NORMAL (12.6k/s -> 124k/s). NORMAL in WAL cannot corrupt
  // the database; the exposure is losing the last commits if the OPERATING
  // SYSTEM crashes, not if this process does — and every write here is UI
  // state that a restart re-reads from omp's own files.
  raw.exec('PRAGMA synchronous = NORMAL');

  const stmts = new Map<string, ReturnType<Database['query']>>();
  const prep = (sql: string) => {
    let stmt = stmts.get(sql);
    if (!stmt) {
      stmt = raw.query(sql);
      stmts.set(sql, stmt);
    }
    return stmt;
  };

  return {
    async get<T>(sql: string, params: any[] = []) {
      return prep(sql).get(...(params as never[])) as T | undefined;
    },
    async all<T>(sql: string, params: any[] = []) {
      return prep(sql).all(...(params as never[])) as T[];
    },
    async run(sql: string, params: any[] = []) {
      // Through `prep`, like `get`/`all`: `Database.run` does not cache its
      // query (it prepares and finalizes per call), which cost every INSERT /
      // UPDATE / DELETE a compile — measured 0.881 µs/op against 0.627 µs/op
      // for the cached statement.
      const result = prep(sql).run(...(params as never[]));
      return { changes: result.changes, lastID: Number(result.lastInsertRowid) };
    },
    async writeMany(sql: string, paramsList: readonly any[][], chunkSize = 200) {
      if (paramsList.length === 0) return 0;
      const stmt = prep(sql);
      const apply = raw.transaction((rows: readonly any[][]) => {
        for (const params of rows) stmt.run(...(params as never[]));
        return rows.length;
      });
      let written = 0;
      for (let start = 0; start < paramsList.length; start += chunkSize) {
        written += apply(paramsList.slice(start, start + chunkSize));
      }
      return written;
    },
    async exec(sql: string) {
      raw.exec(sql);
    },
    raw,
  };
}
