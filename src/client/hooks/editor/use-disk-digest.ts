/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor's disk watcher: the periodic question "are the bytes behind this
 * tab still the ones the buffer holds?".
 *
 * It asks `/api/fs/digest`, which answers with the file's CONTENT hash, and it
 * compares that against the hash the buffer was read at (and, for a write, the
 * hash of the bytes that write landed). Two consequences, both deliberate:
 *
 * - a file rewritten with identical bytes (`git checkout` of the revision
 *   already open, a formatter that changes nothing, a `touch`) does NOT reach
 *   the buffer, because nothing about the document changed. The caller hears
 *   `onUnchanged` instead and may adopt the moved mtime — the save path's
 *   conflict base is still an mtime, so a touched file would otherwise refuse
 *   the next save over a change that never happened;
 * - a file whose mtime did not move but whose bytes did (two writes inside one
 *   filesystem clock tick) is still seen, which an mtime poll cannot do.
 *
 * **Polling, not a filesystem watch**: the server has no watcher to subscribe
 * to, and this app runs on the same machine as the tree, so one scoped request
 * every few seconds is cheaper than a watch per open tab. The probe is skipped
 * while the page is hidden and never overlaps itself. A workspace refresh (`revision`)
 * and the window regaining focus both ask immediately, so the common case —
 * the user alt-tabs back after an external edit — does not wait for the next tick.
 *
 * A `gone` or `unknown` verdict reports NOTHING: a deleted file belongs to
 * `useMissingFiles` (which owns the struck-through tab), and a dropped request
 * must not be read as "the disk changed".
 */

import { useEffect, useRef } from 'preact/hooks';

/**
 * How often an open tab asks whether its file moved.
 *
 * 3s is chosen against what the answer costs: the server hashes the file (cached
 * against its stat, so an unchanged file costs one `stat`), and a text file the
 * editor opens is at most 32 MiB. A shorter interval buys nothing — the user is
 * coming back from another window, and focus asks immediately — while a longer
 * one lets a tool call and the next keystroke race visibly.
 */
export const DISK_DIGEST_INTERVAL_MS = 3000;

/** What the disk says about the file behind a tab. */
export interface DiskDigest {
  /** The file's content hash — the value every producer in the app agrees on. */
  hash: string;
  /** Rounded to a whole millisecond, exactly as the read route reports it. */
  mtimeMs: number;
}

/**
 * Ask the server for the digest of `path`, inside the tab's own scope.
 *
 * Exported because the three "no verdict" answers are the whole rule and are
 * only testable without a mounted component.
 */
export async function probeDiskDigest(
  path: string,
  root: string | null,
  repo: string | null,
): Promise<DiskDigest | 'gone' | 'unknown'> {
  const params = new URLSearchParams({ path });
  if (root) params.set('root', root);
  if (repo && repo !== '.') params.set('repo', repo);
  try {
    const res = await fetch(`/api/fs/digest?${params.toString()}`);
    const data = (await res.json().catch(() => null)) as
      | { exists?: unknown; mtimeMs?: unknown; hash?: unknown }
      | null;
    if (!res.ok || !data || typeof data.exists !== 'boolean') return 'unknown';
    if (data.exists === false) return 'gone';
    // No hash is a file too large for the editor, or an unreadable one: there is
    // nothing to compare, so there is no verdict.
    if (typeof data.hash !== 'string' || typeof data.mtimeMs !== 'number') return 'unknown';
    return { hash: data.hash, mtimeMs: data.mtimeMs };
  } catch {
    return 'unknown';
  }
}

interface UseDiskDigestOptions {
  /** The file the tab names; `null` disables the watcher. */
  path: string | null;
  root?: string | null;
  repo?: string | null;
  /** The hash the buffer was read at (or the one its last save wrote). */
  baseHash: string | null;
  /** Bumped whenever something may have written the tree — asks immediately. */
  revision: number;
  /** The bytes on disk are the ones the buffer holds; only the clock moved. */
  onUnchanged: (mtimeMs: number) => void;
  /** The disk bytes differ from the buffer's fingerprint. */
  onChanged: (digest: DiskDigest) => void;
}

export function useDiskDigest({
  path,
  root = null,
  repo = null,
  baseHash,
  revision,
  onUnchanged,
  onChanged,
}: UseDiskDigestOptions): void {
  // The callbacks are rebuilt whenever the caller's state moves (and a new
  // `baseHash` restarts this effect anyway), so they are read through refs: a
  // dependency on their identity would tear the interval down on every keystroke.
  const unchangedRef = useRef(onUnchanged);
  unchangedRef.current = onUnchanged;
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;

  useEffect(() => {
    // No baseline means no comparison: an inline attachment, a handle-backed
    // tab, a byte viewer or a file the read refused all land here.
    if (!path || baseHash === null) return;

    let cancelled = false;
    let inFlight = false;
    /** The hash already reported, so one external write fires once. */
    let reported: string | null = null;

    const check = async () => {
      if (cancelled || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const verdict = await probeDiskDigest(path, root, repo);
        if (cancelled || verdict === 'unknown' || verdict === 'gone') return;
        if (verdict.hash === baseHash) {
          unchangedRef.current(verdict.mtimeMs);
          return;
        }
        if (reported === verdict.hash) return;
        reported = verdict.hash;
        changedRef.current(verdict);
      } finally {
        inFlight = false;
      }
    };

    const timer = window.setInterval(() => void check(), DISK_DIGEST_INTERVAL_MS);
    // A workspace refresh is a write somewhere, and coming back to the window is
    // the moment the user expects the tab to be current.
    void check();
    const onFocus = () => void check();
    const onVisibility = () => {
      if (!document.hidden) void check();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [path, root, repo, baseHash, revision]);
}
