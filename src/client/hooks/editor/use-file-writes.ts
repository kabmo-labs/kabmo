/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The editor's write path: the debounced autosave, the explicit Save, the
 * flush-on-unmount, and the confirmation a deleted file requires.
 *
 * Split from `useFileEditor` because it is a self-contained stateful cluster —
 * one timer, one in-flight request, one dialog — and because the hook that
 * owns the read and the buffer cache was at the repository's line ceiling.
 *
 * Two rules are load-bearing here, and both are about a write the user did NOT
 * ask for:
 *
 * - **A file deleted under the tab is never written back by a timer.** The
 *   buffer is still on screen and the tab is struck through, so a keystroke
 *   would otherwise recreate the file on disk — a side effect of typing, not a
 *   decision. The debounced write stands down, and closing the editor does not
 *   flush either.
 * - **An explicit Save on a deleted file ASKS first.** Recreating it is a real
 *   choice (the user may have deleted it on purpose), so `saveNow` opens the
 *   confirmation instead of writing, and only `confirmSaveMissing` passes the
 *   `allowMissing` flag that the guard accepts.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { LineEnding } from '@/shared/lib/code/line-endings';
import { saveEditorFile } from '@/client/hooks/editor/save-file';
import type { FileEditorTarget } from '@/client/hooks/editor/use-file-editor';

/**
 * A mutable ref, typed structurally rather than through Preact's `RefObject`:
 * that one is `{ current: T | null }`, and every ref here is read without a
 * null check because the caller assigns it during render.
 */
interface LiveRef<T> {
  current: T;
}

/** The debounced write waiting to fire, if any. */
export interface PendingWrite {
  timer: number;
  file: FileEditorTarget;
  content: string;
}

export interface FileWriteDeps {
  target: FileEditorTarget | null;
  isImage: boolean;
  /** A failed read left no trustworthy buffer, so there is nothing to write. */
  loadError: string | null;
  /** The file this tab names is gone from disk. */
  missing: boolean;
  /** The live buffer, read at FIRE time — a timer captured an older render. */
  contentsRef: LiveRef<Record<string, string>>;
  /** The live line endings, so the write restores the file's own style. */
  lineEndingsRef: LiveRef<Record<string, LineEnding>>;
  /** Owned by the caller: the read effect consults it to yield to a queued write. */
  pendingRef: LiveRef<PendingWrite | null>;
  /** Flush a pending debounced write on unmount so closing cannot drop an edit. */
  flushOnUnmount: boolean;
  /** A write started; the toolbar shows `saving`. */
  onSaveStart: () => void;
  /** A write landed; the baseline moves and the workspace re-reads. */
  onSaved: (fileKey: string, text: string) => void;
  /** A write was refused or dropped. */
  onSaveFailed: () => void;
}

export interface FileWrites {
  onChange: (next: string) => void;
  saveNow: () => void;
  /** A Save was asked for while the file is gone; the user has not answered. */
  saveMissingConfirm: boolean;
  /** Write the buffer anyway — this recreates the file on disk. */
  confirmSaveMissing: () => void;
  /** Dismiss the dialog; nothing is written and the buffer stays dirty. */
  cancelSaveMissing: () => void;
}

/** The key a target's buffer is cached under — mirrors `useFileEditor`'s own. */
function targetKey(target: FileEditorTarget): string {
  return String(target.id ?? target.path ?? target.name);
}

export function useFileWrites({
  target,
  isImage,
  loadError,
  missing,
  contentsRef,
  lineEndingsRef,
  pendingRef,
  flushOnUnmount,
  onSaveStart,
  onSaved,
  onSaveFailed,
}: FileWriteDeps): FileWrites {
  const [saveMissingConfirm, setSaveMissingConfirm] = useState(false);

  // Live mirror of "the file is gone". Both writers below fire from timers that
  // captured an older render, so the decision to stand down has to be read at
  // FIRE time, not at schedule time.
  const missingRef = useRef(missing);
  missingRef.current = missing;

  const key = target ? targetKey(target) : '';

  const persist = useCallback(
    async (file: FileEditorTarget, text: string, options: { allowMissing?: boolean } = {}) => {
      if (!file.path) return;
      // Writing the buffer back would CREATE a file that was deleted — see the
      // module doc. `confirmSaveMissing` is the only caller that allows it.
      if (missingRef.current && !options.allowMissing) return;
      onSaveStart();
      const fileKey = targetKey(file);
      // The buffer is LF; the file's own ending is applied by the server, so an
      // untouched CRLF file stays byte-identical and an LF file stays LF.
      const written = await saveEditorFile(file, text, lineEndingsRef.current[fileKey] ?? 'lf');
      if (written) onSaved(fileKey, text);
      else onSaveFailed();
    },
    [lineEndingsRef, onSaveFailed, onSaveStart, onSaved],
  );

  const persistRef = useRef(persist);
  persistRef.current = persist;

  const onChange = useCallback(
    (next: string) => {
      if (!target || isImage) return;
      if (!target.path) return;
      // No timer at all while the file is gone. `persist` would drop the write
      // anyway, so this is belt-and-braces: it keeps `pendingRef` clear, which
      // is what the read effect consults before yielding to a queued write.
      if (missingRef.current) return;
      if (pendingRef.current) window.clearTimeout(pendingRef.current.timer);
      const timer = window.setTimeout(() => {
        pendingRef.current = null;
        void persistRef.current(target, next);
      }, 800);
      pendingRef.current = { timer, file: target, content: next };
    },
    [target, isImage, pendingRef],
  );

  const saveNow = useCallback(() => {
    if (!target || isImage) return;
    // A file whose read failed has no trustworthy buffer: saving it would write
    // the empty placeholder over the real file. The user must reopen it first.
    if (loadError) return;
    const text = contentsRef.current[targetKey(target)];
    if (text === undefined) return;
    // Cancel any queued autosave either way: the explicit Save owns the key now,
    // and a timer left armed would write again a moment later.
    if (pendingRef.current) {
      window.clearTimeout(pendingRef.current.timer);
      pendingRef.current = null;
    }
    // The file is gone. Recreating it is a decision, not a keystroke's side
    // effect, so ask before writing anything.
    if (missingRef.current) {
      setSaveMissingConfirm(true);
      return;
    }
    void persistRef.current(target, text);
  }, [target, contentsRef, isImage, loadError, pendingRef]);

  const confirmSaveMissing = useCallback(() => {
    setSaveMissingConfirm(false);
    if (!target || isImage || loadError) return;
    const text = contentsRef.current[targetKey(target)];
    if (text === undefined) return;
    void persistRef.current(target, text, { allowMissing: true });
  }, [target, contentsRef, isImage, loadError]);

  const cancelSaveMissing = useCallback(() => setSaveMissingConfirm(false), []);

  useEffect(() => {
    if (!flushOnUnmount) return;
    return () => {
      const pending = pendingRef.current;
      if (!pending) return;
      window.clearTimeout(pending.timer);
      pendingRef.current = null;
      // A file deleted under the tab must not be recreated by closing the
      // editor — the same unasked write the autosave refuses.
      if (missingRef.current) return;
      void persistRef.current(pending.file, pending.content);
    };
  }, [flushOnUnmount, pendingRef]);

  // A tab whose file came back (or a switch to one that is present) must not
  // leave the confirm dialog parked over it.
  useEffect(() => {
    if (!missing) setSaveMissingConfirm(false);
  }, [missing, key]);

  return { onChange, saveNow, saveMissingConfirm, confirmSaveMissing, cancelSaveMissing };
}
