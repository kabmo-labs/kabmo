import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getLanguageFromPath } from '@/shared/lib/code/language';
import { resolveViewer } from '@/client/hooks/editor/resolve-viewer';
import { detectLineEnding, toDiskText, toLf, type LineEnding } from '@/shared/lib/code/line-endings';
import { retainKeys } from '@/client/hooks/editor/save-file';
import { fileHandleFor } from '@/client/lib/launch/file-handlers';
import { useFileRead } from '@/client/hooks/editor/use-file-read';
import { useFileTransfer } from '@/client/hooks/editor/use-file-transfer';
import { useFileWrites } from '@/client/hooks/editor/use-file-writes';
import { useWriteConflict } from '@/client/hooks/editor/use-write-conflict';
import type { FileEditorSaveStatus, FileEditorTarget, UseFileEditorOptions, UseFileEditorResult } from '@/client/hooks/editor/file-editor-types';

export type { FileEditorSaveStatus, FileEditorTarget, UseFileEditorOptions, UseFileEditorResult } from '@/client/hooks/editor/file-editor-types';

function targetKey(target: FileEditorTarget): string {
  return String(target.id ?? target.path ?? target.name);
}

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
  const [saveStatus, setSaveStatus] = useState<FileEditorSaveStatus>('idle');
  /** Bumped by `reset()` to re-run the read effect for the active file. */
  const [revision, setRevision] = useState(0);

  const key = target ? targetKey(target) : '';
  // An inline `content` (attachment chip) can carry CRLF too, and the buffer it
  // feeds is LF-only — normalizing here keeps `isDirty` comparing like with like.
  const content = target ? (contents[key] ?? (target.content !== undefined ? toLf(target.content) : '')) : '';
  const isDirty = content !== (baselines[key] ?? content);
  /**
   * The dirty set, derived from the two caches rather than tracked separately:
   * a second copy would be a second thing to keep in step, and the comparison is
   * a string identity check per open buffer.
   */
  const dirtyKeys = useMemo(() => {
    const next = new Set<string>();
    for (const [bufferKey, text] of Object.entries(contents)) {
      const baseline = baselines[bufferKey];
      if (baseline !== undefined && text !== baseline) next.add(bufferKey);
    }
    return next;
  }, [contents, baselines]);

  // The viewer, its bytes and the image URL — see `resolve-viewer.ts` for the
  // three rules this derivation encodes (the kind comes from the path; a
  // handle-backed tab has no server path; an image keeps its own URL field).
  const { viewerKind, isBinaryViewer, isImage, imageUrl, byteSource } = resolveViewer(target, revision);

  // Keys whose read has been requested or served, so a re-render cannot fire a
  // duplicate fetch while the first one is still in flight.
  const loadedRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<{ timer: number; file: FileEditorTarget; content: string } | null>(null);

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

  const remember = useCallback((fileKey: string, text: string, mtimeMs: number | null) => {
    // The buffer holds LF only; the style the bytes arrived with is kept beside
    // it so the write can put the file back the way it was found.
    const ending = detectLineEnding(text);
    const lf = toLf(text);
    setContents((prev) => ({ ...prev, [fileKey]: lf }));
    setBaselines((prev) => ({ ...prev, [fileKey]: lf }));
    setLineEndings((prev) => ({ ...prev, [fileKey]: ending }));
    setMtimes((prev) => ({ ...prev, [fileKey]: mtimeMs }));
  }, []);

  /**
   * The read path lives in its own hook — see `use-file-read.ts` for the two
   * flags it reports and why the kind refusal is separate from a failed read.
   */
  const { isLoading, loadError, unsupported } = useFileRead({
    target,
    key,
    isBinaryViewer,
    revision,
    loadedRef,
    contentsRef,
    baselinesRef,
    pendingRef,
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
    onSaved: (fileKey, text) => {
      setSaveStatus('saved');
      setBaselines((prev) => ({ ...prev, [fileKey]: text }));
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

  const reset = useCallback(() => {
    // Invalidate every key, then let the read effect refetch the active one.
    // Content is deliberately NOT cleared: it stays on screen until the fresh
    // bytes land, so a refresh can never blank the editor (or drop the file
    // that is open) while the request is in flight.
    loadedRef.current.clear();
    setRevision((prev) => prev + 1);
  }, []);

  /**
   * Switch the ending this buffer saves in.
   *
   * Only the ending moves: the BUFFER is LF-only either way, and the bytes are built
   * at write time, so nothing on screen changes and no re-read is needed.
   */
  const setEol = useCallback((next: LineEnding) => {
    if (!target) return;
    setLineEndings((prev) => ({ ...prev, [targetKey(target)]: next }));
  }, [target]);

  const retain = useCallback((ids: Array<number | string>) => {
    const keep = new Set(ids.map(String));
    for (const loaded of Array.from(loadedRef.current)) {
      if (!keep.has(loaded)) loadedRef.current.delete(loaded);
    }
    setContents((prev) => retainKeys(prev, keep));
    setLineEndings((prev) => retainKeys(prev, keep));
    setMtimes((prev) => retainKeys(prev, keep));
  }, []);

  return {
    content,
    onChange,
    isLoading,
    // A byte viewer has no buffer to wait for, and inline content is already in
    // hand; otherwise the key's entry exists only once the read resolved.
    loaded: target ? isBinaryViewer || target.content !== undefined || contents[key] !== undefined : false,
    loadError,
    unsupported,
    saveStatus,
    copied,
    isDirty,
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
    handleMissing: Boolean(target?.handleId) && fileHandleFor(target?.handleId) === null,
    saveNow: writes.saveNow,
    copy,
    download,
    reset,
    retain,
    saveMissingConfirm: writes.saveMissingConfirm,
    confirmSaveMissing: writes.confirmSaveMissing,
    cancelSaveMissing: writes.cancelSaveMissing,
    conflict: conflictState.conflict,
    resolveConflictByReload: conflictState.reload,
    resolveConflictByKeepingMine: conflictState.keepMine,
    // Revert and Reload are the same operation: throw the buffer away and take the
    // disk copy. Two names because the reason differs — a Revert is the user's own
    // choice, a Reload is an answer to a conflict — and neither needs its own path.
    revertToDisk: conflictState.reload,
    adoptDiskMtime: conflictState.adopt,
  };
}
