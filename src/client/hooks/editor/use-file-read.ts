/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor's read path: one fetch per file key, with the three facts a caller
 * needs to draw the result.
 *
 * Split from `useFileEditor` because it is a self-contained effect with its own
 * state (loading, the failure, and whether the failure was about the file's
 * KIND), and because the hook above it was at the repository's per-file line
 * ceiling. The cache and the write path stay there — this module only reads.
 *
 * Three answers, and the difference between the last two is the point:
 *
 * - `loadError` is set for ANY failed read, and it is the single gate the write
 *   path consults: a refused read leaves an empty buffer, so a Save must be
 *   disabled or it would write that emptiness over the real file.
 * - `unsupported` is set only when the server refused the file for its KIND
 *   (`binary` / `too-large`). It changes the WORDING, never the gating — a zip
 *   was read fine and is simply not text, which is a different sentence from
 *   "could not read".
 */

import { useEffect, useState } from 'preact/hooks';

/** A mutable ref, typed structurally — every ref here is read without a null check. */
interface LiveRef<T> {
  current: T;
}

/** The debounced write waiting to fire, if any. Mirrors `use-file-writes`. */
interface PendingWrite {
  timer: number;
  file: { id?: number | string; name: string; path?: string };
  content: string;
}

/**
 * A read the server refused for the file's KIND, not for a transport failure.
 *
 * `kind` travels on the error because the two need different wording and only
 * the response knows which it was.
 */
interface FileReadError extends Error {
  kind?: 'binary' | 'too-large';
}

export interface FileReadTarget {
  id?: number | string;
  name: string;
  path?: string;
  content?: string;
  root?: string;
  repo?: string;
}

export interface UseFileReadOptions {
  target: FileReadTarget | null;
  /** The target's cache key, so the effect re-runs when the file changes. */
  key: string;
  isBinaryViewer: boolean;
  /** Bumped by `reset()` to force a re-read of the active file. */
  revision: number;
  /** Cache keys whose read has been requested or served. */
  loadedRef: LiveRef<Set<string>>;
  /** Live buffer mirrors, so a late response yields to newer keystrokes. */
  contentsRef: LiveRef<Record<string, string>>;
  baselinesRef: LiveRef<Record<string, string>>;
  /** The queued write, which owns the key if it is still pending. */
  pendingRef: LiveRef<PendingWrite | null>;
  /**
   * How many reads are in flight, so the auto-refresh watcher does not ask for a
   * second one while the first is still on its way.
   */
  readingRef: LiveRef<number>;
  /**
   * Store bytes, the line ending they arrived with, the mtime they were read at,
   * and the hash of those bytes.
   *
   * The mtime is the save path's conflict base: a write whose base no longer
   * matches the disk is refused rather than clobbering another writer's change.
   * The hash is the auto-refresh watcher's baseline: a file that still hashes
   * the same has not changed, however far its mtime moved.
   */
  remember: (fileKey: string, text: string, mtimeMs: number | null, hash: string | null) => void;
}

export interface FileReadState {
  isLoading: boolean;
  /**
   * A read is in flight over content that is already on screen — the manual
   * "Reload from disk" (or a workspace refresh), never the first load.
   *
   * `isLoading` deliberately stays `false` for those reads (a spinner over live
   * content is the bug it prevents), so the toolbar's reload glyph had no state
   * to spin for. This is that state, and it is false during a first load so the
   * glyph does not spin while the opening read is what the overlay already
   * reports.
   */
  isReading: boolean;
  loadError: string | null;
  /** Set only for a refusal about the file's kind; see the module note. */
  unsupported: string | null;
}

/** The key a target's buffer is cached under — mirrors `useFileEditor`'s own. */
function targetKey(target: FileReadTarget): string {
  return String(target.id ?? target.path ?? target.name);
}

export function useFileRead({
  target,
  key,
  isBinaryViewer,
  revision,
  loadedRef,
  contentsRef,
  baselinesRef,
  pendingRef,
  readingRef,
  remember,
}: UseFileReadOptions): FileReadState {
  const [isLoading, setIsLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);

  // Read the active file once per key. A cancelled guard keeps a late response
  // from a previous file from overwriting the one now on screen.
  useEffect(() => {
    setReading(false);
    if (!target) return;
    const fileKey = targetKey(target);
    if (loadedRef.current.has(fileKey)) return;
    loadedRef.current.add(fileKey);

    // A byte-drawing viewer (image, PDF, DOCX, workbook) has no text to read:
    // its surface fetches the raw bytes itself. Fetching here would decode them
    // into replacement characters, so the key is marked loaded and left
    // bufferless.
    if (isBinaryViewer) {
      setLoadError(null);
      setUnsupported(null);
      setIsLoading(false);
      return;
    }

    if (target.content !== undefined) {
      // Inline content (an attachment chip) has no file behind it, so there is no
      // mtime to check a later write against.
      remember(fileKey, target.content, null, null);
      setLoadError(null);
      setUnsupported(null);
      return;
    }

    if (!target.path) {
      // An attachment chip with no path has nothing to read and nothing to
      // save; the message is the honest outcome.
      setLoadError('No file path supplied for this attachment.');
      setUnsupported(null);
      return;
    }

    // Only a key with nothing on screen yet shows the loading state: a
    // re-read (refreshKey / reset) must not flash a spinner over live content.
    const firstLoad = contentsRef.current[fileKey] === undefined;
    let cancelled = false;
    if (firstLoad) setIsLoading(true);
    setLoadError(null);
    setUnsupported(null);
    const params = new URLSearchParams({ path: target.path });
    if (target.root) params.set('root', target.root);
    if (target.repo && target.repo !== '.') params.set('repo', target.repo);
    readingRef.current += 1;
    setReading(true);
    fetch(`/api/fs/read?${params.toString()}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as
          | { content?: unknown; error?: string; kind?: 'binary' | 'too-large'; mtimeMs?: unknown; hash?: unknown }
          | null;
        if (!res.ok || !data || typeof data.content !== 'string') {
          const error: FileReadError = new Error(data?.error || `HTTP ${res.status}`);
          // 415 is the server saying "this file's kind is not a document". The
          // status is the fallback for a body the response could not carry.
          if (data?.kind) error.kind = data.kind;
          else if (res.status === 415) error.kind = 'binary';
          throw error;
        }
        return {
          text: data.content,
          mtimeMs: typeof data.mtimeMs === 'number' ? data.mtimeMs : null,
          hash: typeof data.hash === 'string' ? data.hash : null,
        };
      })
      .then(({ text, mtimeMs, hash }) => {
        if (cancelled) return;
        // These bytes were read before the response arrived, so anything typed
        // since is newer. Applying them would replace those keystrokes (and,
        // once a refresh is triggered by a save, wipe the editor back to an
        // empty buffer) — instead let the queued write own the key.
        const typed = contentsRef.current[fileKey];
        if (typed !== undefined && typed !== baselinesRef.current[fileKey]) return;
        const queued = pendingRef.current;
        if (queued && targetKey(queued.file) === fileKey) return;
        remember(fileKey, text, mtimeMs, hash);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // A failed re-read keeps what is on screen; only a first load reports.
        if (!firstLoad) return;
        // An empty buffer, never a substitute: the next save would write the
        // substitute over the real file.
        remember(fileKey, '', null, null);
        const message = err instanceof Error ? err.message : 'Failed to read file';
        const kind = (err as FileReadError)?.kind;
        setUnsupported(kind ? message : null);
        setLoadError(message);
      })
      .finally(() => {
        readingRef.current -= 1;
        if (!cancelled) {
          setIsLoading(false);
          setReading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [key, target, remember, revision, isBinaryViewer, loadedRef, contentsRef, baselinesRef, pendingRef, readingRef]);

  // A first load keeps `isLoading` true for the same read, so the reload glyph
  // must not also claim it: this flag is about re-reads only.
  return { isLoading, isReading: reading && !isLoading, loadError, unsupported };
}
