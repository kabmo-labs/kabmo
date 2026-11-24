/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The run-wide fallback database, loaded by `bunfig.toml`'s `[test] preload`.
 *
 * Per-suite isolation (`isolateDb`/`releaseDb`) is the contract, and it is what
 * keeps a suite's writes inside its own temp file. It cannot cover work that
 * outlives its suite: production code fires writes and forgets them
 * (`void noteChildOutcome(...)`, `void syncDiscoveryRootsWatch()`), and such a
 * continuation can call `getDb()` AFTER `releaseDb` deleted `KABMO_DB_PATH`.
 * The path is then the default one — the developer's real `~/.kabmo/db.sqlite`.
 *
 * `DB_PATH` is the LOWEST-precedence spelling (`KABMO_DB_PATH` ->
 * `OMPCHAMBER_DB_PATH` -> `DB_PATH`), so a suite that isolates still wins, and
 * `releaseDb` (which deletes only `KABMO_DB_PATH`) hands late work back to this
 * temp file instead of the developer's home. Measured on a full `bun test` with
 * a tracer around `createDb`: two opens of the real path remained after every
 * suite was isolated, one from a debounced roots-watch reconcile and one from
 * an ACP child-outcome write; both fall to this file and the tracer reports
 * zero.
 *
 * `afterAll` here runs ONCE for the whole run (measured: a preload hook is not
 * per file), which is where the directory is removed. The handle is closed
 * first — a live SQLite handle makes the delete fail with `EBUSY` on Windows.
 */

import { afterAll } from 'bun:test';

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closeDb } from '@/server/db.server';
import { removeDir } from '@/test-support/remove-dir';

const dir = mkdtempSync(join(tmpdir(), 'kabmo-test-fallback-db-'));
// Assigned, not overwritten: an operator running `bun test` with `DB_PATH` set
// asked for that file, and no suite should silently redirect it.
Bun.env.DB_PATH ??= join(dir, 'db.sqlite');

// The Token Usage index reads every ACP harness store under the home directory.
// A suite that only redirects omp's sessions root would otherwise fold the
// developer's real Claude/Codex/OpenCode history into its assertions. The hook
// is a ROOT, not a set of store paths, so a suite can still override one store
// with its own variable (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, ...).
const usageRoot = mkdtempSync(join(tmpdir(), 'kabmo-test-usage-stores-'));
Bun.env.KABMO_USAGE_ACP_ROOT = usageRoot;

afterAll(async () => {
  await closeDb();
  removeDir(dir);
  removeDir(usageRoot);
});
