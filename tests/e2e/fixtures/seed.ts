/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fixture data created through the REAL API, never by writing the database.
 *
 * A spec that inserted rows directly would test a state the app cannot
 * produce: the folder's `project_path` and the session's `cwd` are resolved by
 * the routes, the sidebar reads a scan, and a hand-written row skips all of
 * it. So a fixture here is one `fetch` against the running server, and the app
 * arrives at the state the same way a user's click would.
 */

import type { HarnessServer } from './server';
import { makeTempDir } from './temp-root';

export interface SeededWorkspace {
  /** The folder's id, for `?folderId=`. */
  id: number;
  /**
   * The directory the folder is bound to, AS THE SERVER RESOLVED IT.
   *
   * Not the raw `mkdtemp` result: the route runs the path through `resolve()`
   * before storing it, and every scope check downstream (`resolveRoot`, the
   * terminal's `?root=`, the git/files panels) compares against that stored
   * spelling exactly. Handing a spec the un-resolved string makes those checks
   * depend on the two spellings agreeing, which they do not on Windows — where
   * a temp directory is reachable under both an 8.3 short name and its long
   * form. Measured: `terminal-capacity` attached eight ready shells and the
   * `?root=`-filtered inventory answered an empty list for the whole 20 s poll.
   */
  path: string;
  dispose(): void;
}

/** Create a workspace folder bound to a fresh temp directory. */
export async function seedWorkspace(server: HarnessServer, name = 'e2e-workspace'): Promise<SeededWorkspace> {
  const dir = makeTempDir('ws-');
  const response = await fetch(`${server.baseURL}/api/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, path: dir }),
  });
  if (!response.ok) {
    throw new Error(`seedWorkspace failed: ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    id?: unknown;
    folder?: { id?: unknown; project_path?: unknown };
  };
  const id = Number(payload.id ?? payload.folder?.id);
  if (!Number.isFinite(id)) {
    throw new Error(`seedWorkspace: no id in response ${JSON.stringify(payload)}`);
  }
  // The route `resolve()`s the path before storing it; hand the caller the
  // stored spelling, never the one this fixture happened to build.
  const stored = payload.folder?.project_path;
  return {
    id,
    path: typeof stored === 'string' && stored ? stored : dir,
    dispose() {
      // Queue it rather than deleting now: the server has this directory open
      // (it scanned it), so a delete here races the process on Windows.
      server.removeAfterStop(dir);
    },
  };
}

/** Wait until `predicate` holds, polling `intervalMs`, up to `timeoutMs`. */
export async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 20_000, intervalMs = 200): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() >= deadline) throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
