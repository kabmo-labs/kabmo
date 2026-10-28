/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "This file changed on disk while you were editing it."
 *
 * The editor never noticed: it subscribed to no realtime topic, and the only re-read
 * was a manual Refresh. With the 800 ms autosave that is a data-loss path — an agent
 * (or another tab, or `git checkout`) writes a file the user has open, and the next
 * keystroke writes the stale buffer over it.
 *
 * ## Why the `fs:` topic's own revision and not a file watcher
 *
 * `workspace-dirty` already republishes every watched `fs:`/`git:` topic after each
 * tool call and each run end, and the panel's `refreshKey` carries the same signal
 * for its own writes. A server-side `fs.watch` per open file would be a new
 * process-wide resource for one strip.
 *
 * ## The probe asks ONE question, and a refusal is not a verdict
 *
 * The topic payload is a directory listing; what this needs is one file's mtime.
 * `/api/fs/exists` already answers the scope question with the same allow-list and
 * the same containment, so it grew an `mtimeMs`. A refused or dropped probe says
 * nothing about the file, and reporting it as "changed" would offer a Reload over a
 * perfectly current buffer — so only a real answer counts, and `unknown` is its own
 * outcome rather than a silent "fine".
 *
 * ## Only a DIRTY buffer asks
 *
 * A clean buffer has nothing to lose: re-reading it silently is what the read effect
 * already does on a refresh. The strip exists for the case where the user's edits and
 * the disk's bytes disagree, which is precisely `isDirty`.
 */

import { useEffect, useRef, useState } from 'preact/hooks';

/** What a probe learned. */
export type ExternalChangeVerdict =
  /** The disk still holds the bytes this buffer was built from. */
  | { kind: 'unchanged' }
  /** The disk moved: both sides, so the strip can say when. */
  | { kind: 'changed'; mtimeMs: number; baseMtimeMs: number }
  /** The file is gone; the tab strip's strike-through owns that fact. */
  | { kind: 'gone' }
  /** No answer — a refused request, a malformed body, a file with no mtime. */
  | { kind: 'unknown' };

/** The change a buffer has to be told about, or null. */
export interface DiskChange {
  mtimeMs: number;
  baseMtimeMs: number;
}

/**
 * Ask the server whether `path` still has the mtime the buffer was built from.
 *
 * Exported because the three "no verdict" branches are the whole rule, and they are
 * only testable without a mounted component.
 */
export async function probeExternalChange(
  path: string,
  root: string | null,
  repo: string | null,
  baseMtimeMs: number,
): Promise<ExternalChangeVerdict> {
  const params = new URLSearchParams({ path });
  if (root) params.set('root', root);
  if (repo && repo !== '.') params.set('repo', repo);
  try {
    const res = await fetch(`/api/fs/exists?${params.toString()}`);
    const data = (await res.json().catch(() => null)) as { exists?: unknown; mtimeMs?: unknown } | null;
    if (!res.ok || !data || typeof data.exists !== 'boolean') return { kind: 'unknown' };
    if (data.exists === false) return { kind: 'gone' };
    if (typeof data.mtimeMs !== 'number') return { kind: 'unknown' };
    return data.mtimeMs === baseMtimeMs
      ? { kind: 'unchanged' }
      : { kind: 'changed', mtimeMs: data.mtimeMs, baseMtimeMs };
  } catch {
    return { kind: 'unknown' };
  }
}

interface UseExternalChangeOptions {
  /** The file the buffer came from; `null` for an inline attachment or a handle. */
  path: string | null;
  root?: string | null;
  repo?: string | null;
  /** The mtime the buffer was read at — the value the save path would send. */
  baseMtimeMs: number | null;
  /** Only a dirty buffer has anything to lose. */
  dirty: boolean;
  /**
   * Bumped whenever something may have written the tree.
   *
   * The panel's `refreshKey` already carries this (a save, a Files-panel delete, a
   * workspace refresh), and the realtime topic adds the agent's own writes.
   */
  revision: number;
}

/**
 * The disk change this buffer has to be told about, or null.
 *
 * The probe runs on `revision` (a write somewhere) and on the base moving (a save
 * that landed). A save updates `baseMtimeMs` to what the server wrote, and
 * re-probing with the NEW base is what clears the strip — comparing against a base
 * the probe never saw would leave it up over a file the user just saved.
 */
export function useExternalChange({
  path,
  root = null,
  repo = null,
  baseMtimeMs,
  dirty,
  revision,
}: UseExternalChangeOptions): DiskChange | null {
  const [change, setChange] = useState<DiskChange | null>(null);
  /** The base the last probe asked about, so a re-render does not re-probe. */
  const askedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!path || !dirty || baseMtimeMs === null) {
      setChange(null);
      askedRef.current = null;
      return;
    }
    if (askedRef.current === baseMtimeMs) return;
    let cancelled = false;
    void probeExternalChange(path, root, repo, baseMtimeMs).then((verdict) => {
      if (cancelled) return;
      askedRef.current = baseMtimeMs;
      // `unknown` deliberately leaves the previous answer alone: a dropped probe
      // must not raise a strip, and it must not clear one the user is reading
      // either — the next revision asks again.
      if (verdict.kind === 'unknown') return;
      setChange(verdict.kind === 'changed' ? { mtimeMs: verdict.mtimeMs, baseMtimeMs: verdict.baseMtimeMs } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [path, root, repo, baseMtimeMs, dirty, revision]);

  return change;
}
