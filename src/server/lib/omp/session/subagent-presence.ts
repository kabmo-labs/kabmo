/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Cached "does this session have subagents?" probe.
 *
 * The sidebar loader asks this for EVERY session on EVERY fetch. The honest
 * answer needs the session file's `task` toolCalls, which is the authoritative
 * roster — but reading them means parsing a file that can reach hundreds of
 * megabytes, and doing that per session per fetch dominated the endpoint's cost
 * (the dataset scan itself is cached; this probe was not).
 *
 * The roster can only change when the session file gains entries or its
 * sibling artifacts directory changes, so that (last-entry timestamp,
 * sibling-dir mtime) pair is a sufficient cache version. Both cost one stat —
 * orders of magnitude cheaper than the parse they gate. The timestamp is the
 * file's last ENTRY time, not its mtime: a title-slot rewrite bumps mtime
 * without appending anything, and a spurious version bump would re-run the
 * parse it exists to avoid.
 */

import { promises as fs, statSync } from 'fs';
import { extractSubagentHistory } from '@/server/lib/omp/subagent/history';
import { siblingDirForSession } from '@/server/lib/omp/subagent/history/paths';

interface PresenceEntry {
  version: string;
  hasSubagents: boolean;
}

/** Bounded so a long-lived server with many sessions cannot grow unbounded. */
const MAX_ENTRIES = 2_000;

const cache = new Map<string, PresenceEntry>();

/**
 * Version of the sibling artifacts directory, or `0` when it does not exist —
 * which is the COMMON case, since most sessions never spawn a subagent.
 *
 * The stat is SYNC (`statSync` + `throwIfNoEntry: false`) rather than an
 * awaited `fs.stat`, because an awaited one rejects on that common path and a
 * caught rejection from `fs` is still reported by Bun's rejection tracker when
 * this module is re-evaluated by `bun run --hot` — the dev server, and any
 * `kabmo serve` whose NODE_ENV is unset. The result was a full ENOENT
 * report with a `Bun v1.4.2` footer printed over a healthy server's own sidebar
 * reads. Measured on Bun 1.4.2 against this exact function — 40 concurrent
 * probes per request, 40 module rewrites, 6 runs: `try { await fs.stat(dir) }
 * catch {}` reported ENOENT 8-12 times, `.catch()` 4-8 times, while both
 * `throwIfNoEntry: false` and `statSync` reported zero, all yielding the same
 * `0` and the same `hasSubagents: false`. The distinguishing property is not
 * the error handling but whether a rejected promise is created at all; a sync
 * throw is caught on the spot and never reaches the tracker.
 *
 * Cost is not a concern: 343 sessions (this machine's sidebar) cost 0.37 ms per
 * read versus 0.32 ms for the async form — 0.055 ms, on a read that runs at
 * most every few seconds.
 */
function siblingDirVersion(dir: string): number {
  try {
    // Only ENOENT is suppressed; EACCES and the like still throw and are
    // swallowed here, leaving the `0` contract intact.
    return statSync(dir, { throwIfNoEntry: false })?.mtimeMs ?? 0;
  } catch {
    return 0;
  }
}

export async function sessionHasSubagents(
  sessionPath: string,
  sessionLastEntryAt: string,
): Promise<boolean> {
  const siblingDir = siblingDirForSession(sessionPath);
  const siblingMtime = siblingDirVersion(siblingDir);
  const version = `${sessionLastEntryAt}:${siblingMtime}`;

  const cached = cache.get(sessionPath);
  if (cached && cached.version === version) return cached.hasSubagents;

  let hasSubagents = false;
  // Guarded on the version: an unguarded readdir on the absent dir is the same
  // spurious-rejection leak, and it rejects on the same sessions. The try/catch
  // is what remains for a genuine read failure (the dir removed between the
  // stat and here), which is rare enough not to be the reported noise.
  if (siblingMtime !== 0) {
    try {
      const files = await fs.readdir(siblingDir);
      hasSubagents = files.some((file) => file.endsWith('.jsonl'));
    } catch {
      hasSubagents = false;
    }
  }
  if (!hasSubagents) {
    try {
      hasSubagents = (await extractSubagentHistory(sessionPath)).length > 0;
    } catch {
      hasSubagents = false;
    }
  }

  if (!cached && cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(sessionPath, { version, hasSubagents });
  return hasSubagents;
}
