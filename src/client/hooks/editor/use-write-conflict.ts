/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The conflict state machine: which buffer's write was refused, and the three
 * answers it offers.
 *
 * Split out of `useFileEditor` for the repository's per-file ceiling, and it earns
 * the boundary: everything here is one concern — "the disk and this buffer
 * disagree" — with its own state and its own three transitions. The hook that owns
 * the buffers supplies the setters and the refs; this decides what happens to them.
 *
 * ## The three answers, and why each writes the mtime the way it does
 *
 * - **Reload** takes the disk copy: it clears the buffer's baseline AND its content
 *   so the read effect treats the next pass as a first load, because the
 *   dirty-buffer guard would otherwise keep the stale bytes on screen.
 * - **Keep mine** writes the buffer over the disk copy, adopting the disk mtime as
 *   the new base FIRST — without that the same `409` comes back on every retry.
 * - **Adopt** takes the disk mtime without writing anything: the answer to an
 *   external-change notice when the user wants to keep editing.
 *
 * The ref is written directly as well as the state in every case that moves the
 * base: `persist` reads the ref at FIRE time, so a debounced write already armed in
 * this tick must see the new base or it goes out with the old one and is refused.
 */

import { useCallback, useState } from 'preact/hooks';

/** A refused write: the disk holds `diskMtimeMs`, or null when it named none. */
export interface WriteConflict {
  diskMtimeMs: number | null;
}

/** Mutable refs the caller owns; every one is read without a null check. */
interface LiveRef<T> {
  current: T;
}

export interface ConflictDeps {
  /** The active buffer's key, or `''` when nothing is open. */
  key: string;
  /** Writes the ACTIVE buffer. */
  saveNow: () => void;
  /** Mtimes by buffer key — the save path's conflict base. */
  mtimesRef: LiveRef<Record<string, number | null>>;
  setMtimes: (next: Record<string, number | null>) => void;
  /** Live buffer text, so "Keep mine" reads what is on screen NOW. */
  contentsRef: LiveRef<Record<string, string>>;
  setContents: (update: (previous: Record<string, string>) => Record<string, string>) => void;
  setBaselines: (update: (previous: Record<string, string>) => Record<string, string>) => void;
  /** Keys already read, so a reload can force a fresh read. */
  loadedRef: LiveRef<Set<string>>;
  /** Forces the read effect to re-run for the active file. */
  bumpRevision: () => void;
}

export interface ConflictState {
  /** The ACTIVE buffer's conflict, or null. */
  conflict: WriteConflict | null;
  /** A write was refused; the panel shows the strip. */
  report: (fileKey: string, diskMtimeMs: number | null) => void;
  /** Take the disk copy, discarding the buffer's edits. */
  reload: () => void;
  /** Write the buffer over the disk copy. */
  keepMine: () => void;
  /** Adopt the disk mtime as the base, writing nothing. */
  adopt: (diskMtimeMs: number) => void;
  /** Clear one buffer's entry without resolving anything. */
  clear: (fileKey: string) => void;
}

export function useWriteConflict({
  key,
  saveNow,
  mtimesRef,
  setMtimes,
  contentsRef,
  setContents,
  setBaselines,
  loadedRef,
  bumpRevision,
}: ConflictDeps): ConflictState {
  const [conflicts, setConflicts] = useState<Record<string, WriteConflict>>({});

  const clear = useCallback((fileKey: string) => {
    setConflicts((previous) => {
      if (previous[fileKey] === undefined) return previous;
      const next = { ...previous };
      delete next[fileKey];
      return next;
    });
  }, []);

  const report = useCallback((fileKey: string, diskMtimeMs: number | null) => {
    setConflicts((previous) => ({ ...previous, [fileKey]: { diskMtimeMs } }));
  }, []);

  /** Move the base for `fileKey`, in the ref the write path reads and in state. */
  const adoptBase = useCallback(
    (fileKey: string, diskMtimeMs: number) => {
      mtimesRef.current = { ...mtimesRef.current, [fileKey]: diskMtimeMs };
      setMtimes(mtimesRef.current);
    },
    [mtimesRef, setMtimes],
  );

  const adopt = useCallback(
    (diskMtimeMs: number) => {
      if (!key) return;
      adoptBase(key, diskMtimeMs);
      clear(key);
    },
    [key, adoptBase, clear],
  );

  const reload = useCallback(() => {
    if (!key) return;
    clear(key);
    // Forget the cached baseline AND the content so the buffer counts as a first
    // load: `useFileRead` keeps a dirty buffer's bytes on screen, which is the
    // behaviour that would otherwise make "Reload" do nothing.
    setBaselines((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
    setContents((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
    loadedRef.current.delete(key);
    bumpRevision();
  }, [key, clear, setBaselines, setContents, loadedRef, bumpRevision]);

  const keepMine = useCallback(() => {
    if (!key) return;
    const text = contentsRef.current[key];
    const diskMtimeMs = conflicts[key]?.diskMtimeMs ?? null;
    clear(key);
    if (text === undefined) return;
    // Adopt BEFORE writing: the write below sends this base, and the server must
    // see a match or it refuses again.
    if (diskMtimeMs !== null) adoptBase(key, diskMtimeMs);
    saveNow();
  }, [key, conflicts, clear, adoptBase, contentsRef, saveNow]);

  return { conflict: conflicts[key] ?? null, report, reload, keepMine, adopt, clear };
}
