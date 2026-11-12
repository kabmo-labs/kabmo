import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getLanguageFromPath } from '@/shared/lib/code/language';
import { resolveViewer } from '@/client/hooks/editor/resolve-viewer';
import { toDiskText, toLf, type LineEnding } from '@/shared/lib/code/line-endings';
import { deviceFileFor } from '@/client/lib/launch/device-files';
import { fileHandleFor } from '@/client/lib/launch/file-handlers';
import { useFileRead } from '@/client/hooks/editor/use-file-read';
import { useFileTransfer } from '@/client/hooks/editor/use-file-transfer';
import { useFileWrites } from '@/client/hooks/editor/use-file-writes';
import { useWriteConflict } from '@/client/hooks/editor/use-write-conflict';
import { useDiskSync } from '@/client/hooks/editor/use-disk-sync';
import { useFileCache } from '@/client/hooks/editor/use-file-cache';
import { editorTargetKey as targetKey } from '@/client/hooks/editor/target-key';
import type { FileEditorSaveStatus, FileEditorTarget, UseFileEditorOptions, UseFileEditorResult } from '@/client/hooks/editor/file-editor-types';

export type { FileEditorSaveStatus, FileEditorTarget, UseFileEditorOptions, UseFileEditorResult } from '@/client/hooks/editor/file-editor-types';

/**
 * Owns the file-editing contract shared by the desktop editor and the phone's
 * full-screen editor: read, debounced FormData save, copy, download, dirty
 * tracking, and language resolution. Content is cached per file key so
 * switching tabs does not re-read a file whose edits are still in memory.
 */
export function useFileEditor(
  target: FileEditorTarget | null,
  options: UseFileEditorOptions = {},
): UseFileEditorResult {
  const {
    flushOnUnmount = false,
    reportSaveError = false,
    downloadMimeType = 'text/plain',
    onFileSaved,
    missing = false,
  } = options;

  const [contents, setContents] = useState<Record<string, string>>({});
  const [baselines, setBaselines] = useState<Record<string, string>>({});
  /**
   * The line ending each cached file arrived with. The buffer itself can only
   * hold LF (a textarea strips CR), so the style has to live beside it or a
   * CRLF file would be rewritten as LF by a one-character edit.
   */
  const [lineEndings, setLineEndings] = useState<Record<string, LineEnding>>({});
  /**
   * The mtime each cached file was READ at.
   *
   * The save path sends it as `baseMtime`, and a write whose base no longer
   * matches the disk is refused (`409`) instead of clobbering a change made by an
   * agent, another tab or another editor. `null` means "no expectation" — an
   * inline attachment, a handle-backed file, or a read that failed.
   */
  const [mtimes, setMtimes] = useState<Record<string, number | null>>({});
  /**
   * The content hash of the bytes each cached file was read at (or last wrote).
   *
   * The auto-refresh watcher compares the disk against it, so a file rewritten
   * with identical bytes — a checkout of the revision already open, a formatter
   * that changes nothing, a `touch` — never replaces a buffer. `null` means "no
   * fingerprint": an inline attachment, a failed read, a file too large for the
   * digest, or a handle-backed write (nothing to hash against).
   */
  const [hashes, setHashes] = useState<Record<string, string | null>>({});
  const [saveStatus, setSaveStatus] = useState<FileEditorSaveStatus>('idle');
  /**
   * Files whose BINARY document (a workbook) holds unsaved edits.
   *
   * Kept beside the text caches rather than inside them because the value is a
   * flag, not a buffer: the edited workbook itself lives in the viewer's draft
   * store, and this set is what the tab strip and the close guard read.
   */
  const [binaryDirtyKeys, setBinaryDirtyKeys] = useState<ReadonlySet<string>>(() => new Set());
  /** Bumped by `reset()` to re-run the read effect for the active file. */
  const [revision, setRevision] = useState(0);

  const key = target ? targetKey(target) : '';
  // An inline `content` (attachment chip) can carry CRLF too, and the buffer it
  // feeds is LF-only — normalizing here keeps `isDirty` comparing like with like.
  const content = target ? (contents[key] ?? (target.content !== undefined ? toLf(target.content) : '')) : '';
  const textDirty = content !== (baselines[key] ?? content);
  const isDirty = textDirty || binaryDirtyKeys.has(key);
  /**
   * The dirty set, derived from the two caches rather than tracked separately:
   * a second copy would be a second thing to keep in step, and the comparison is
   * a string identity check per open buffer.
   */
  const dirtyKeys = useMemo(() => {
    const next = new Set<string>(binaryDirtyKeys);
    for (const [bufferKey, text] of Object.entries(contents)) {
      const baseline = baselines[bufferKey];
      if (baseline !== undefined && text !== baseline) next.add(bufferKey);
    }
    return next;
  }, [contents, baselines, binaryDirtyKeys]);

  // The viewer, its bytes and the image URL — see `resolve-viewer.ts` for the
  // three rules this derivation encodes (the kind comes from the path; a
  // handle-backed tab has no server path; an image keeps its own URL field).
  const { viewerKind, isBinaryViewer, isImage, imageUrl, byteSource } = resolveViewer(target, revision);

  // Keys whose read has been requested or served, so a re-render cannot fire a
  // duplicate fetch while the first one is still in flight.
  const loadedRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<{ timer: number; file: FileEditorTarget; content: string } | null>(null);
  /** Reads on their way — see `useFileRead`. */
  const readingRef = useRef(0);

  // Live mirrors of the content maps: a read response resolves long after it
  // was requested, and it has to know whether the buffer it read is still the
  // one on screen.
  const contentsRef = useRef(contents);
  contentsRef.current = contents;
  const baselinesRef = useRef(baselines);
  baselinesRef.current = baselines;
  // `persist` is a stable callback, so the ending it writes back is read from a
  // live mirror rather than captured in its closure.
  const lineEndingsRef = useRef(lineEndings);
  lineEndingsRef.current = lineEndings;
  const mtimesRef = useRef(mtimes);
  mtimesRef.current = mtimes;
  const hashesRef = useRef(hashes);
  hashesRef.current = hashes;

  /**
   * The cache's lifecycle (refresh everything, drop closed tabs, switch the saved
   * ending) lives in its own hook — see `use-file-cache.ts` for why the five caches
   * must move together.
   */
  const { remember, reset, retain, setEol } = useFileCache({
    target,
    loadedRef,
    bumpRevision: () => setRevision((prev) => prev + 1),
    setContents,
    setBaselines,
    setLineEndings,
    setMtimes,
    setHashes,
  });

  /**
   * The read path lives in its own hook — see `use-file-read.ts` for the two
   * flags it reports and why the kind refusal is separate from a failed read.
   */
  const { isLoading, isReading, loadError, unsupported } = useFileRead({
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
  });

  /**
   * The write path (debounced autosave, explicit Save, the deleted-file
   * confirmation) lives in its own hook — see `use-file-writes.ts` for why a
   * deleted file is never written back by a timer.
   *
   * It is called through a ref because `onChange` below must stay stable while
   * the callbacks it forwards to are rebuilt on every render.
   */
  const writes = useFileWrites({
    target,
    isBinaryViewer,
    loadError,
    missing,
    contentsRef,
    lineEndingsRef,
    mtimesRef,
    pendingRef,
    flushOnUnmount,
    onSaveStart: () => setSaveStatus('saving'),
    onSaved: (fileKey, text, written) => {
      setSaveStatus('saved');
      setBaselines((prev) => ({ ...prev, [fileKey]: text }));
      // Adopt what the server reported about the bytes it just wrote: the mtime
      // is the next save's conflict base, and the hash is the auto-refresh
      // baseline. Without them the watcher would read the user's own save as an
      // external change, and the next save would be refused against its base.
      if (written.mtimeMs !== null) setMtimes((prev) => ({ ...prev, [fileKey]: written.mtimeMs }));
      if (written.hash !== null) setHashes((prev) => ({ ...prev, [fileKey]: written.hash }));
      onFileSaved?.();
    },
    onSaveFailed: () => setSaveStatus(reportSaveError ? 'error' : 'idle'),
    // Not a failure: the buffer is intact and one Save (a real gesture) grants
    // the access a handle-backed file needs.
    onNeedsPermission: () => setSaveStatus('needs-permission'),
    // A conflict is a verdict, not a failure: the buffer is intact and the disk
    // holds someone else's bytes. `saveStatus` stays `idle` because the write did
    // not happen, and the panel's own strip owns the Reload/Keep choice.
    onConflict: (fileKey, diskMtimeMs) => {
      // Not a failure: the buffer is intact and the panel's own strip owns the
      // Reload/Keep choice, so the toolbar's save status stays idle.
      setSaveStatus('idle');
      conflictState.report(fileKey, diskMtimeMs);
    },
  });
  const writesRef = useRef(writes);
  writesRef.current = writes;

  /**
   * The conflict state machine.
   *
   * Built after the write hook because its "Keep mine" answer writes through
   * `writesRef` — the same path the toolbar's Save uses, so there is one write
   * implementation rather than two that can disagree about the base mtime.
   */
  const conflictState = useWriteConflict({
    key,
    saveNow: () => writesRef.current.saveNow(),
    mtimesRef,
    setMtimes,
    contentsRef,
    setContents,
    setBaselines,
    loadedRef,
    bumpRevision: () => setRevision((prev) => prev + 1),
  });

  /**
   * Drop the debounced write for `fileKey`, if one is armed.
   *
   * A Reload throws the buffer away, so the write that buffer had queued must go
   * with it — and the read path yields to a queued write, so leaving it armed
   * would also make the reload land nowhere.
   */
  const discardPendingWrite = useCallback((fileKey: string) => {
    const queued = pendingRef.current;
    if (!queued || targetKey(queued.file) !== fileKey) return;
    window.clearTimeout(queued.timer);
    pendingRef.current = null;
  }, []);

  /**
   * The disk watcher and the answers it produces — one cluster, in its own hook
   * (see `use-disk-sync.ts`): a clean buffer follows the disk, a dirty one is
   * never replaced, and a file that still hashes the same is not a change.
   *
   * The conflict machine is passed in rather than imported there so "adopt the
   * mtime" and "discard and re-read" stay the SAME implementations the strips
   * call; a second copy is how one of them refuses a save the other accepted.
   */
  const { diskChange, reloadFromDisk, keepMineAgainstDisk } = useDiskSync({
    key,
    target,
    baseHash: hashes[key] ?? null,
    revision,
    hashesRef,
    mtimesRef,
    contentsRef,
    baselinesRef,
    pendingRef,
    readingRef,
    loadedRef,
    bumpRevision: () => setRevision((prev) => prev + 1),
    adoptDiskMtime: conflictState.adopt,
    clearConflict: conflictState.clear,
    reloadDiscardingEdits: conflictState.reload,
    discardPendingWrite,
  });

  useEffect(() => {
    if (saveStatus !== 'saved') return;
    const timer = window.setTimeout(() => setSaveStatus('idle'), 1500);
    return () => window.clearTimeout(timer);
  }, [saveStatus]);

  // The save status describes the file that was written, so it must not outlive
  // that tab: opening another file used to keep showing the previous file's
  // "Save failed" (and its error icon) against a file that was never saved.
  useEffect(() => {
    setSaveStatus('idle');
  }, [key]);

  const setBinaryDirty = useCallback(
    (dirty: boolean) => {
      if (!target) return;
      const fileKey = targetKey(target);
      setBinaryDirtyKeys((previous) => {
        if (previous.has(fileKey) === dirty) return previous;
        const next = new Set(previous);
        if (dirty) next.add(fileKey);
        else next.delete(fileKey);
        return next;
      });
    },
    [target],
  );

  /**
   * `retain` also drops the binary flags of tabs that are no longer open: a
   * closed tab's flag would otherwise keep the close guard armed for a file
   * that is not on screen.
   */
  const retainAll = useCallback(
    (ids: Array<number | string>) => {
      retain(ids);
      const keep = new Set(ids.map(String));
      setBinaryDirtyKeys((previous) => {
        let changed = false;
        const next = new Set<string>();
        for (const fileKey of previous) {
          if (keep.has(fileKey)) next.add(fileKey);
          else changed = true;
        }
        return changed ? next : previous;
      });
    },
    [retain],
  );

  const onChange = useCallback(
    (next: string) => {
      if (!target || isBinaryViewer) return;
      const fileKey = targetKey(target);
      setContents((prev) => ({ ...prev, [fileKey]: next }));
      writesRef.current.onChange(next);
    },
    [target, isBinaryViewer],
  );

  const { copied, copy, download } = useFileTransfer({
    target,
    content,
    // A download is the file leaving the app, so it carries the file's own line
    // endings — the LF buffer is an artifact of the textarea, not of the file.
    // Copy stays the buffer: it is a text selection, and CRLF in a pasted
    // snippet is noise every destination editor would normalize anyway.
    downloadContent: target ? toDiskText(content, lineEndings[key] ?? 'lf') : content,
    imageUrl,
    downloadMimeType,
    // A byte viewer's bytes are not in the buffer, so its download (and, for an
    // image, its copy) reads them from the source.
    byteSource,
    byteViewer: isBinaryViewer,
  });


  return {
    content,
    onChange,
    isLoading,
    isReading,
    // A byte viewer has no buffer to wait for, and inline content is already in
    // hand; otherwise the key's entry exists only once the read resolved.
    loaded: target ? isBinaryViewer || target.content !== undefined || contents[key] !== undefined : false,
    loadError,
    unsupported,
    saveStatus,
    copied,
    isDirty,
    setBinaryDirty,
    eol: lineEndings[key] ?? 'lf',
    setEol,
    baseMtimeMs: mtimes[key] ?? null,
    dirtyKeys,
    language: target ? getLanguageFromPath(target.name) : 'javascript',
    isImage,
    imageUrl,
    viewerKind,
    byteSource,
    isBinaryViewer,
    revision,
    // A device-backed tab has no handle by design, so it must not read as
    // "the permission ended" — `deviceBacked` is the accurate answer, and the
    // surface words the two differently.
    handleMissing: Boolean(target?.handleId) && !target?.deviceFile && fileHandleFor(target?.handleId) === null,
    deviceBacked: Boolean(target?.deviceFile),
    deviceMissing: Boolean(target?.deviceFile) && deviceFileFor(target?.handleId) === null,
    saveNow: writes.saveNow,
    copy,
    download,
    reset,
    retain: retainAll,
    saveMissingConfirm: writes.saveMissingConfirm,
    confirmSaveMissing: writes.confirmSaveMissing,
    cancelSaveMissing: writes.cancelSaveMissing,
    conflict: conflictState.conflict,
    resolveConflictByReload: () => {
      if (key) discardPendingWrite(key);
      conflictState.reload();
    },
    resolveConflictByKeepingMine: conflictState.keepMine,
    reloadFromDisk,
    diskChange,
    keepMineAgainstDisk,
  };
}
