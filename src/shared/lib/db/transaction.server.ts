import type { DbClient } from '@kabmo-labs/kabmo-db/client';

/**
 * Run `fn` inside a BEGIN…COMMIT block.
 *
 * `bun:sqlite` is synchronous, so the promise-chain mutex the old async driver
 * needed is gone: a transaction block runs to completion before any other
 * JavaScript executes, which makes `BEGIN`…`COMMIT` atomic by construction.
 */
export function withTransaction<T>(db: DbClient, fn: () => T): T {
  db.raw.exec('BEGIN');
  try {
    const result = fn();
    db.raw.exec('COMMIT');
    return result;
  } catch (error) {
    db.raw.exec('ROLLBACK');
    throw error;
  }
}
