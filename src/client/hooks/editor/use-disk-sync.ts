/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor's disk SYNCHRONISATION: the watcher, the two answers it produces,
 * and the manual Reload.
 *
 * Split from `useFileEditor` because it is a self-contained cluster — one poll,
 * one verdict, one counter the panel renders — and it is the piece with a rule
 * worth naming:
 *
 * - **A CLEAN buffer follows the disk.** Nothing of the user's is at stake, so a
 *   file changed by an agent, a `git checkout` or another editor is re-read
 *   without asking. The bytes stay on screen until the response lands.
 * - **A DIRTY buffer never does.** Its edits are the user's, and only the user
 *   can say which side wins, so the hook reports a revision instead and the
 *   panel asks (the external-change strip).
 * - **A file that still hashes the same is not a change.** Its mtime may have
 *   moved (`touch`, a no-op formatter, a checkout of the revision already open);
 *   that only means the save path's conflict base must move with it, or the next
 *   save would be refused over a change that never happened.
 *
 * Reload is the manual counterpart: it re-reads even a clean buffer (the answer
 * to "read it again"), and it discards a dirty one — including the debounced
 * write sitting behind those edits, which would otherwise land after the read
 * and put the discarded text back on disk.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { FileEditorTarget } from '@/client/hooks/editor/file-editor-types';
import type { PendingWrite } from '@/client/hooks/editor/use-file-writes';
import { useDiskDigest, type DiskDigest } from '@/client/hooks/editor/use-disk-digest';
import { editorTargetKey } from '@/client/hooks/editor/target-key';
import { isProbeableTab } from '@/client/hooks/workspace/missing-files';

/** A mutable ref, typed structurally — every ref here is read without a null check. */
interface LiveRef<T> {
  current: T;
}

export interface DiskSyncDeps {
  /** The active buffer's key, or `''` when nothing is open. */
  key: string;
  target: FileEditorTarget | null;
  /** The hash the ACTIVE buffer was read at (or the one its last save wrote). */
  baseHash: string | null;
  /** Bumped by `reset()`/a save; also what makes the watcher ask immediately. */
  revision: number;
  hashesRef: LiveRef<Record<string, string | null>>;
  mtimesRef: LiveRef<Record<string, number | null>>;
  contentsRef: LiveRef<Record<string, string>>;
  baselinesRef: LiveRef<Record<string, string>>;
  pendingRef: LiveRef<PendingWrite | null>;
  /** Reads on their way — a verdict must not queue a second one. */
  readingRef: LiveRef<number>;
  loadedRef: LiveRef<Set<string>>;
  /** Forces the read effect to re-run for the active file. */
  bumpRevision: () => void;
  /** Take the disk's mtime as this buffer's base, writing nothing. */
  adoptDiskMtime: (diskMtimeMs: number) => void;
  /** Drop one buffer's conflict entry without resolving anything. */
  clearConflict: (fileKey: string) => void;
  /** Discard the active buffer and re-read it. */
  reloadDiscardingEdits: () => void;
  /** Drop the debounced write for a key. */
  discardPendingWrite: (fileKey: string) => void;
}

export interface DiskSync {
  /**
   * The disk bytes differ from a buffer that HAS edits, or null.
   *
   * Nothing was replaced: the panel renders this as the external-change strip, so
   * the user chooses between the two copies. Cleared by itself as soon as the
   * buffer and the disk agree again (a reload, a save, a "Keep mine" write).
   */
  diskChange: DiskDigest | null;
  reloadFromDisk: () => void;
  /**
   * Answer the strip with the user's buffer: adopt the disk's mtime and stop
   * asking about THIS change.
   *
   * Nothing is written — the buffer stays dirty and the autosave owns the write —
   * and the accepted hash is remembered, so the watcher does not raise the same
   * strip again on its next poll. A LATER change is a new hash and asks again.
   */
  keepMineAgainstDisk: () => void;
}

export function useDiskSync({
  key,
  target,
  baseHash,
  revision,
  hashesRef,
  mtimesRef,
  contentsRef,
  baselinesRef,
  pendingRef,
  readingRef,
  loadedRef,
  bumpRevision,
  adoptDiskMtime,
  clearConflict,
  reloadDiscardingEdits,
  discardPendingWrite,
}: DiskSyncDeps): DiskSync {
  const [diskChange, setDiskChange] = useState<DiskDigest | null>(null);
  /**
   * The hash the user answered "Keep mine" about, so the same change is not
   * reported again on the next poll.
   *
   * A ref rather than state: the watcher reads it from a callback that must stay
   * stable, and dismissing a strip is not something the UI derives from.
   */
  const dismissedRef = useRef<string | null>(null);

  // The verdict describes the tab it was made for; switching tabs must not carry
  // a stale "changed on disk" strip onto another file.
  useEffect(() => {
    setDiskChange(null);
    dismissedRef.current = null;
  }, [key]);

  const adoptUnchangedMtime = useCallback(
    (diskMtimeMs: number) => {
      if (!key) return;
      // The bytes are the ones this buffer holds; only the clock moved. Adopting
      // the mtime keeps the next save from being refused over nothing, and it is
      // also the answer to a strip the user has already seen: the disk is not
      // ahead of the buffer, so there is nothing left to ask.
      if (mtimesRef.current[key] !== diskMtimeMs) adoptDiskMtime(diskMtimeMs);
      setDiskChange(null);
      // The bytes agree again, so a dismissal of an older change is spent.
      dismissedRef.current = null;
    },
    [key, mtimesRef, adoptDiskMtime],
  );

  const adoptDiskChange = useCallback(
    (digest: DiskDigest) => {
      if (!key) return;
      // A probe that started before the last read landed compares against a
      // baseline that has since moved; the live hash is the truth, and the bytes
      // it names are already on screen.
      if (hashesRef.current[key] === digest.hash) {
        setDiskChange(null);
        return;
      }
      if (dismissedRef.current === digest.hash) return;
      if (diskChange?.hash === digest.hash) return;
      const typed = contentsRef.current[key];
      const queued = pendingRef.current;
      const dirty =
        (typed !== undefined && typed !== baselinesRef.current[key]) ||
        (queued !== null && editorTargetKey(queued.file) === key);
      if (dirty) {
        setDiskChange(digest);
        return;
      }
      // A read already on its way (a workspace refresh, a manual Reload, an
      // earlier verdict) will land these bytes; asking again would be one more
      // request for the same answer.
      if (readingRef.current > 0) return;
      loadedRef.current.delete(key);
      bumpRevision();
    },
    [key, hashesRef, contentsRef, baselinesRef, pendingRef, readingRef, loadedRef, bumpRevision, diskChange],
  );

  useDiskDigest({
    // Same predicate the tab strip and the phone use for "this tab names a file
    // on disk": a diff tab, an attachment chip and a handle/device file have no
    // server path to ask about. The id only satisfies the predicate's shape.
    path: target && isProbeableTab({ ...target, id: key }) ? target.path ?? null : null,
    root: target?.root ?? null,
    repo: target?.repo ?? null,
    baseHash,
    revision,
    onUnchanged: adoptUnchangedMtime,
    onChanged: adoptDiskChange,
  });

  const reloadFromDisk = useCallback(() => {
    if (!target) return;
    const fileKey = editorTargetKey(target);
    const typed = contentsRef.current[fileKey];
    const dirty = typed !== undefined && typed !== baselinesRef.current[fileKey];
    if (dirty) {
      discardPendingWrite(fileKey);
      reloadDiscardingEdits();
      return;
    }
    clearConflict(fileKey);
    loadedRef.current.delete(fileKey);
    bumpRevision();
  }, [target, contentsRef, baselinesRef, discardPendingWrite, reloadDiscardingEdits, clearConflict, loadedRef, bumpRevision]);

  const keepMineAgainstDisk = useCallback(() => {
    if (!diskChange) return;
    // Remember the exact change that was dismissed: the disk still has those
    // bytes until the buffer's own write lands, so the watcher would otherwise
    // raise the strip again three seconds later.
    dismissedRef.current = diskChange.hash;
    adoptDiskMtime(diskChange.mtimeMs);
    setDiskChange(null);
  }, [diskChange, adoptDiskMtime]);

  return { diskChange, reloadFromDisk, keepMineAgainstDisk };
}
