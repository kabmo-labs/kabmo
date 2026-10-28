/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Path derivation + id grammar for on-disk subagent artifacts.
 *
 * A subagent's transcript lives in the parent session's sibling artifacts
 * directory (`<session-dir>/<subagent-id>.jsonl`), so the id grammar bounds
 * session-content-derived ids before they are joined into a path.
 */

import { basename, dirname, join } from 'path';

/** Subagent ids are AdjectiveNoun names, dotted for nested spawns. The grammar
 *  bounds session-content-derived ids before they are joined into a path. */
export const SUBAGENT_ID_RE = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
export const SUBAGENT_ID_MAX_LENGTH = 100;

/** Sibling artifacts directory for a parent session file. */
export function siblingDirForSession(sessionFilePath: string): string {
  return join(dirname(sessionFilePath), basename(sessionFilePath, '.jsonl'));
}

/** Subagent transcript path for a roster id within a parent session. */
export function subagentTranscriptPath(sessionFilePath: string, subagentId: string): string {
  return join(siblingDirForSession(sessionFilePath), `${subagentId}.jsonl`);
}
