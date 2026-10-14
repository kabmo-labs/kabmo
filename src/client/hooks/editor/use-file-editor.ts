import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { getLanguageFromPath } from '@/shared/lib/code/language';
import { getImageMimeType } from '@/shared/lib/fs/file-kind';
import { buildFsRawUrl } from '@/shared/lib/fs/paths';
import { detectLineEnding, toDiskText, toLf, type LineEnding } from '@/shared/lib/code/line-endings';
import { retainKeys } from '@/client/hooks/editor/save-file';
import { fileHandleFor } from '@/client/lib/launch/file-handlers';
import { useFileRead } from '@/client/hooks/editor/use-file-read';
import { useFileTransfer } from '@/client/hooks/editor/use-file-transfer';
import { useFileWrites } from '@/client/hooks/editor/use-file-writes';

export type FileEditorSaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'needs-permission';

/** The single file a code surface is editing; `id` keys the in-memory cache. */
export interface FileEditorTarget {
  id?: number | string;
  name: string;
  path?: string;
  content?: string;
  root?: string;
  repo?: string;
  /** The live handle a PWA launch opened this file through, when there is one. */
  handleId?: string;
}

export interface UseFileEditorOptions {
  /** Flush a pending debounced write on unmount so closing the editor cannot drop an edit. */
  flushOnUnmount?: boolean;
  /** Mark a failed write as `'error'`; otherwise the status returns to `'idle'`. */
  reportSaveError?: boolean;
  /** Blob MIME type for downloads. */
  downloadMimeType?: string;
  /** Fired after a write lands, so workspace panels can refresh. */
  onFileSaved?: () => void;
  /**
   * The file this tab names is gone from disk (the tab strip strikes it
   * through; see `useMissingFiles`).
   *
   * A save then means something the user did not ask for — writing the buffer
   * back would CREATE the file again — so the debounced autosave stands down
   * and an explicit Save asks first. Without this, a keystroke in a tab whose
   * file was deleted a moment ago silently resurrected it on disk.
   */
  missing?: boolean;
}

export interface UseFileEditorResult {
  content: string;
  onChange: (next: string) => void;
  isLoading: boolean;
  /**
   * The current file's bytes have arrived (or it is an image / carries inline
   * content). Distinguishes "the buffer is empty" from "the buffer is not read
   * yet" — `isLoading` cannot, because it starts `false` on the first render and
   * a consumer that trusted it would act on an empty buffer.
   */
  loaded: boolean;
  loadError: string | null;
  /**
   * The server refused this file as a document (binary, or larger than the
   * editor opens), with its own sentence. Distinct from `loadError` only in
   * WORDING — both leave an empty buffer and disable Save — but the difference
   * is what the user needs: a zip was read fine and is simply not text.
   */
  unsupported: string | null;
  saveStatus: FileEditorSaveStatus;
  copied: boolean;
  isDirty: boolean;
  language: string;
  /**
   * A handle-backed tab whose live handle is gone — the page reloaded since the
   * file was launched, and a `FileSystemFileHandle` cannot be persisted. Save
   * is refused (there is nothing to write through), so the surface says why
   * instead of showing a button that silently fails.
   */
  handleMissing: boolean;
  /** True for raster images: the surface renders `imageUrl`, not `content`. */
  isImage: boolean;
  /** Raw-byte URL of the active image (cache-busted per revision), else null. */
  imageUrl: string | null;
  saveNow: () => void;
  copy: () => void;
  download: () => void;
  /**
   * Re-read every cached file from disk (e.g. a workspace refresh). Content
   * already on screen stays until the fresh bytes land, and a file with
   * unsaved edits is left alone.
   */
  reset: () => void;
  /** Drop cached content for files no longer open. */
  retain: (ids: Array<number | string>) => void;
  /** The file was deleted, so a Save is waiting on the user's answer. */
  saveMissingConfirm: boolean;
  /** Write the buffer anyway — this recreates the file on disk. */
  confirmSaveMissing: () => void;
  /** Dismiss the dialog; nothing is written and the buffer stays dirty. */
  cancelSaveMissing: () => void;
}

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
  const [saveStatus, setSaveStatus] = useState<FileEditorSaveStatus>('idle');
  /** Bumped by `reset()` to re-run the read effect for the active file. */
  const [revision, setRevision] = useState(0);

  const key = target ? targetKey(target) : '';
  // An inline `content` (attachment chip) can carry CRLF too, and the buffer it
  // feeds is LF-only — normalizing here keeps `isDirty` comparing like with like.
  const content = target ? (contents[key] ?? (target.content !== undefined ? toLf(target.content) : '')) : '';
  const isDirty = content !== (baselines[key] ?? content);

  // Extension-keyed, matching the server's own classification: an image tab
  // never reads a text buffer and never writes one back. A target without a
  // path has no bytes to serve, and one that already carries inline `content`
  // (an attachment chip) has its text in hand — both stay on the text path.
  const imageTarget =
    target?.path && target.content === undefined && getImageMimeType(target.path) ? target.path : null;
  const isImage = imageTarget !== null;
  const imageUrl = imageTarget ? `${buildFsRawUrl({ ...target, path: imageTarget })}&v=${revision}` : null;

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

  const remember = useCallback((fileKey: string, text: string) => {
    // The buffer holds LF only; the style the bytes arrived with is kept beside
    // it so the write can put the file back the way it was found.
    const ending = detectLineEnding(text);
    const lf = toLf(text);
    setContents((prev) => ({ ...prev, [fileKey]: lf }));
    setBaselines((prev) => ({ ...prev, [fileKey]: lf }));
    setLineEndings((prev) => ({ ...prev, [fileKey]: ending }));
  }, []);

  /**
   * The read path lives in its own hook — see `use-file-read.ts` for the two
   * flags it reports and why the kind refusal is separate from a failed read.
   */
  const { isLoading, loadError, unsupported } = useFileRead({
    target,
    key,
    isImage,
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
    isImage,
    loadError,
    missing,
    contentsRef,
    lineEndingsRef,
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
  });
  const writesRef = useRef(writes);
  writesRef.current = writes;

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
      if (!target || isImage) return;
      const fileKey = targetKey(target);
      setContents((prev) => ({ ...prev, [fileKey]: next }));
      writesRef.current.onChange(next);
    },
    [target, isImage],
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
  });

  const reset = useCallback(() => {
    // Invalidate every key, then let the read effect refetch the active one.
    // Content is deliberately NOT cleared: it stays on screen until the fresh
    // bytes land, so a refresh can never blank the editor (or drop the file
    // that is open) while the request is in flight.
    loadedRef.current.clear();
    setRevision((prev) => prev + 1);
  }, []);

  const retain = useCallback((ids: Array<number | string>) => {
    const keep = new Set(ids.map(String));
    for (const loaded of Array.from(loadedRef.current)) {
      if (!keep.has(loaded)) loadedRef.current.delete(loaded);
    }
    setContents((prev) => retainKeys(prev, keep));
    setLineEndings((prev) => retainKeys(prev, keep));
  }, []);

  return {
    content,
    onChange,
    isLoading,
    // An image has no buffer to wait for, and inline content is already in
    // hand; otherwise the key's entry exists only once the read resolved.
    loaded: target ? isImage || target.content !== undefined || contents[key] !== undefined : false,
    loadError,
    unsupported,
    saveStatus,
    copied,
    isDirty,
    language: target ? getLanguageFromPath(target.name) : 'javascript',
    isImage,
    imageUrl,
    handleMissing: Boolean(target?.handleId) && fileHandleFor(target?.handleId) === null,
    saveNow: writes.saveNow,
    copy,
    download,
    reset,
    retain,
    saveMissingConfirm: writes.saveMissingConfirm,
    confirmSaveMissing: writes.confirmSaveMissing,
    cancelSaveMissing: writes.cancelSaveMissing,
  };
}
