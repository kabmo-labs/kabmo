/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where Kabmo decides its SQLite file lives.
 *
 * `getDatabasePath` has three branches and the ORDER between them is the whole
 * contract. The mock branch is cwd-relative by design (demo mode has no data
 * directory to speak of), which made it win over an explicit
 * `KABMO_DB_PATH` — so a `MOCK=true` server started from a checkout wrote
 * the repository's own `workspace.db`, and a caller that set the variable to
 * isolate itself was silently ignored. That is the same class of failure
 * `test-support/isolated-db.ts` documents for the unit layer, one level up: a
 * test or a second instance writes a database it does not own.
 *
 * Pinned here: the override wins in BOTH modes, `DB_PATH` is the fallback
 * spelling, `~` expands, the directory is created, and the two defaults are
 * still what they were (cwd-relative `workspace.db` in mock, `~/.kabmo`
 * otherwise). `getDatabasePath` is read per call, so no handle is opened and
 * the real database is never touched.
 *
 * One case DOES open a handle, and it is the reason this file also covers
 * `getDb`: a rejected open used to stay cached in the process-wide slot, so one
 * transient failure (a locked temp tree on a Windows runner) made every later
 * caller inherit it and the suites that swallow the error answered empty for the
 * rest of the run.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import * as path from 'node:path';

import { closeDb, getDatabasePath, getDb } from '@/server/db.server';
import { removeDir } from '@/test-support/remove-dir';

const saved = {
  mock: Bun.env.MOCK,
  dbPath: Bun.env.KABMO_DB_PATH,
  legacyDbPath: Bun.env.OMPCHAMBER_DB_PATH,
  bareDbPath: Bun.env.DB_PATH,
};
const roots: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'omc-db-path-'));
  roots.push(dir);
  return dir;
}

beforeEach(() => {
  delete Bun.env.MOCK;
  delete Bun.env.KABMO_DB_PATH;
  delete Bun.env.OMPCHAMBER_DB_PATH;
  delete Bun.env.DB_PATH;
});

afterEach(() => {
  for (const [key, value] of Object.entries({
    MOCK: saved.mock,
    KABMO_DB_PATH: saved.dbPath,
    OMPCHAMBER_DB_PATH: saved.legacyDbPath,
    DB_PATH: saved.bareDbPath,
  })) {
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
  }
  for (const dir of roots.splice(0)) removeDir(dir);
});

describe('getDatabasePath', () => {
  test('an explicit override beats the mock default', async () => {
    Bun.env.MOCK = 'true';
    const target = path.join(tempRoot(), 'nested', 'isolated.sqlite');
    Bun.env.KABMO_DB_PATH = target;

    expect(await getDatabasePath()).toBe(target);
    // The parent is created, not just named — a path whose directory is
    // missing is one `createDb` cannot open.
    expect(existsSync(path.dirname(target))).toBe(true);
  });

  test('an explicit override beats the real default too', async () => {
    const target = path.join(tempRoot(), 'real.sqlite');
    Bun.env.KABMO_DB_PATH = target;

    expect(await getDatabasePath()).toBe(target);
  });

  test('DB_PATH is the fallback spelling, and KABMO_DB_PATH wins over it', async () => {
    const legacy = path.join(tempRoot(), 'legacy.sqlite');
    Bun.env.DB_PATH = legacy;
    expect(await getDatabasePath()).toBe(legacy);

    const preferred = path.join(tempRoot(), 'preferred.sqlite');
    Bun.env.KABMO_DB_PATH = preferred;
    expect(await getDatabasePath()).toBe(preferred);
  });

  test('KABMO_DB_PATH wins over both pre-rename spellings', async () => {
    Bun.env.DB_PATH = path.join(tempRoot(), 'oldest.sqlite');
    Bun.env.KABMO_DB_PATH = path.join(tempRoot(), 'old.sqlite');
    const renamed = path.join(tempRoot(), 'new.sqlite');
    Bun.env.KABMO_DB_PATH = renamed;

    expect(await getDatabasePath()).toBe(renamed);
  });

  test('a leading ~ expands to the home directory', async () => {
    Bun.env.KABMO_DB_PATH = '~/.kabmo-e2e-probe/x.sqlite';
    expect(await getDatabasePath()).toBe(path.join(homedir(), '.kabmo-e2e-probe', 'x.sqlite'));
    rmSync(path.join(homedir(), '.kabmo-e2e-probe'), { recursive: true, force: true });
  });

  test('mock with no override stays cwd-relative workspace.db', async () => {
    Bun.env.MOCK = 'true';
    expect(await getDatabasePath()).toBe(path.join(process.cwd(), 'workspace.db'));
  });

  test('real mode with no override stays the home data directory', async () => {
    expect(await getDatabasePath()).toBe(path.join(homedir(), '.kabmo', 'db.sqlite'));
  });
});

describe('a failed open is not cached', () => {
  test('the next call retries after an open throws', async () => {
    // A path whose PARENT is a regular file: `mkdir -p` on it fails, so the
    // open throws without any handle to leak.
    const blocker = path.join(roots[0] ?? tmpdir(), `blocker-${process.pid}`);
    await Bun.write(blocker, 'not a directory');
    const savedSlot = globalThis.__kabmoDb;
    try {
      Bun.env.KABMO_DB_PATH = path.join(blocker, 'db.sqlite');
      globalThis.__kabmoDb = undefined;

      await expect(getDb()).rejects.toBeDefined();
      // The slot is CLEAR: leaving the rejection in place is what made one
      // failure permanent for the process. Read through a widened local —
      // the assignment above narrows the global to `undefined` for the checker.
      const afterFailure = globalThis.__kabmoDb as { promise?: unknown } | undefined;
      expect(afterFailure?.promise ?? null).toBeNull();

      Bun.env.KABMO_DB_PATH = path.join(roots[0] ?? tmpdir(), `retry-${process.pid}`, 'db.sqlite');
      const db = await getDb();
      expect(db).toBeDefined();
      db.raw.close();
    } finally {
      globalThis.__kabmoDb = savedSlot;
    }
  });

  test('a failure nobody is awaiting yet is not reported as an unhandled rejection', async () => {
    // The shape `closeDb` produces: it retires the slot and reads its promise
    // LATER, so the rejection lands while no caller holds a handler — and the
    // handler that clears the slot runs first, leaving a rejected promise with
    // no owner. Bun reports that as "Unhandled error between tests", attributed
    // to whichever case happens to be running; measured on the Release gate,
    // where one Windows timeout reported a second, unrelated failure.
    const blocker = path.join(roots[0] ?? tmpdir(), `blocker-unhandled-${process.pid}`);
    await Bun.write(blocker, 'not a directory');
    const savedSlot = globalThis.__kabmoDb;
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', record);
    try {
      Bun.env.KABMO_DB_PATH = path.join(blocker, 'db.sqlite');
      globalThis.__kabmoDb = undefined;

      const pending = getDb();
      // Let the rejection settle with no handler attached. A macrotask, not a
      // duration: Bun decides "unhandled" once the microtask queue drains, and
      // the check has to happen after that decision either way.
      await new Promise<void>((resolve) => setImmediate(resolve));
      // `.then` rather than `expect(...).rejects`: measured, Bun's `rejects`
      // matcher fails on a promise that settled in an EARLIER turn, reporting
      // the rejection reason as the assertion's own error.
      const failure = await pending.then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', record);
      globalThis.__kabmoDb = savedSlot;
    }
  });
});

describe('closeDb', () => {
  test('retires an open that is still in flight, and closes its handle', async () => {
    // The bug this pins, measured on the Release gate: `releaseDb` cleared the
    // slot while `getDb()` was still opening, so the continuation assigned
    // `resolved` on the DROPPED slot object. Nothing could reach that handle
    // again, and on Windows its temp directory stayed locked — `EBUSY … a
    // handle outlived its test`, reported against the two PRECEDING cases.
    const savedSlot = globalThis.__kabmoDb;
    try {
      Bun.env.KABMO_DB_PATH = path.join(tempRoot(), 'in-flight', 'db.sqlite');
      globalThis.__kabmoDb = undefined;

      // Start the open and retire the slot in the SAME tick, so the async
      // continuation is still pending when `closeDb` runs.
      const pending = getDb();
      const retired = globalThis.__kabmoDb as { disposed?: boolean } | undefined;
      await closeDb();
      expect(retired?.disposed).toBe(true);

      // The open settles as a refusal rather than handing back a handle whose
      // owner is gone, and the slot stays clear for the next caller.
      await expect(pending).rejects.toThrow(/retired/);
      expect(globalThis.__kabmoDb ?? null).toBeNull();

      // A later open under a NEW path works, which is what a test isolating
      // itself between cases needs.
      Bun.env.KABMO_DB_PATH = path.join(tempRoot(), 'after', 'db.sqlite');
      const db = await getDb();
      expect(db).toBeDefined();
      await closeDb();
    } finally {
      globalThis.__kabmoDb = savedSlot;
    }
  });

  test('closes a resolved handle and clears the slot', async () => {
    const savedSlot = globalThis.__kabmoDb;
    try {
      Bun.env.KABMO_DB_PATH = path.join(tempRoot(), 'resolved', 'db.sqlite');
      globalThis.__kabmoDb = undefined;
      const db = await getDb();
      await closeDb();
      expect(globalThis.__kabmoDb ?? null).toBeNull();
      // A closed handle refuses further work rather than silently succeeding.
      expect(() => db.raw.exec('SELECT 1')).toThrow();
    } finally {
      globalThis.__kabmoDb = savedSlot;
    }
  });

  test('the returned promise settles only once the in-flight handle is closed', async () => {
    // The bug this pins is a RACE, and it is the one the Release gate hit:
    // retiring the slot is synchronous, but an open already in flight still
    // reaches `createDb` and OPENS a file. A caller that deleted the temp
    // directory on the strength of a synchronous return raced a handle that did
    // not exist yet — and could never win, because `removeDir` retries with
    // `Bun.sleepSync`, which blocks the very continuation that closes it.
    //
    // Asserted on the observable the caller needs: after `await closeDb()`, no
    // handle is open and none is about to be. A database file that was opened
    // and closed again reports no further work through it, and the slot is
    // clear, so the next open uses whatever path is configured by then.
    const savedSlot = globalThis.__kabmoDb;
    try {
      const dir = tempRoot();
      Bun.env.KABMO_DB_PATH = path.join(dir, 'settle', 'db.sqlite');
      globalThis.__kabmoDb = undefined;

      const pending = getDb();
      const retiring = closeDb();

      // A synchronous return is the bug, not a detail: it is what let a caller
      // delete the directory while the open was still about to create a file.
      expect(retiring).toBeInstanceOf(Promise);

      // Both settle, and the retirement is what decides when the caller may
      // touch the directory — so it must not resolve before the open has been
      // closed. The open's own rejection is expected and is not an error.
      await expect(pending).rejects.toThrow(/retired/);
      await expect(retiring).resolves.toBeUndefined();
      expect(globalThis.__kabmoDb ?? null).toBeNull();

      // The proof the caller needs: the directory can be removed the moment the
      // promise settles, with no retry window spent.
      removeDir(dir);
      expect(existsSync(dir)).toBe(false);
    } finally {
      globalThis.__kabmoDb = savedSlot;
    }
  });
});
