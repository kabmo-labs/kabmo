/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where a session's Kabmo change journal lives.
 *
 * `~/.kabmo/changes/<sessionId>/` — beside the database, the same root `btw/`
 * uses, so a delete of the data directory takes the journals with it. The
 * session id is a single path segment by construction (omp UUIDs, mock
 * integers); the guard is here because the reader is reached from a route
 * parameter, and `path.join` normalizes a `..` into a different directory.
 */

import path from 'node:path';
import { getDataDir } from '@kabmo-labs/kabmo-paths/paths';
import { isSinglePathSegment } from '@kabmo-labs/kabmo-paths/path-segment';

export function changesRoot(): string {
  return path.join(getDataDir(), 'changes');
}

export function sessionChangesDir(sessionId: string): string {
  if (!isSinglePathSegment(sessionId)) {
    throw new Error(`Invalid session id for a change journal: ${JSON.stringify(sessionId)}`);
  }
  return path.join(changesRoot(), sessionId);
}

export function journalPath(sessionId: string): string {
  return path.join(sessionChangesDir(sessionId), 'changes.jsonl');
}

export function blobsDir(sessionId: string): string {
  return path.join(sessionChangesDir(sessionId), 'blobs');
}
