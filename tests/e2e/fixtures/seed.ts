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

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDirWhenFree } from './remove-dir';
import type { HarnessServer } from './server';

export interface SeededWorkspace {
  /** The folder's id, for `?folderId=`. */
  id: number;
  /** The directory the folder is bound to; a session spawns in it. */
  path: string;
  dispose(): void;
}

/** Create a workspace folder bound to a fresh temp directory. */
export async function seedWorkspace(server: HarnessServer, name = 'e2e-workspace'): Promise<SeededWorkspace> {
  const dir = mkdtempSync(join(tmpdir(), 'omc-e2e-ws-'));
  const response = await fetch(`${server.baseURL}/api/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, path: dir }),
  });
  if (!response.ok) {
    throw new Error(`seedWorkspace failed: ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as { id?: unknown; folder?: { id?: unknown } };
  const id = Number(payload.id ?? payload.folder?.id);
  if (!Number.isFinite(id)) {
    throw new Error(`seedWorkspace: no id in response ${JSON.stringify(payload)}`);
  }
  return {
    id,
    path: dir,
    dispose() {
      removeDirWhenFree(dir);
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
