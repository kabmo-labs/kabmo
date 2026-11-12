/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor's per-file CACHE lifecycle: throw every cached read away, keep only
 * the files still open, and switch the ending a buffer saves in.
 *
 * These three belong together because they all answer "what does the cache hold
 * right now", and they must touch EVERY cache — the bytes, the baselines, the
 * line endings, the mtimes and the content hashes. A `retain` that forgot one of
 * them left an entry a later tab could inherit under the same key; the hash list
 * is part of that set, or a reopened tab would compare the disk against a
 * fingerprint from the file it used to be.
 *
 * `reset` deliberately does NOT clear the bytes: they stay on screen until the
 * fresh read lands, so a workspace refresh can never blank the editor.
 */

import { useCallback } from 'preact/hooks';
import { retainKeys } from '@/client/hooks/editor/save-file';
import { editorTargetKey } from '@/client/hooks/editor/target-key';
import type { FileEditorTarget } from '@/client/hooks/editor/file-editor-types';
import { detectLineEnding, toLf, type LineEnding } from '@/shared/lib/code/line-endings';

/** A mutable ref, typed structurally — every ref here is read without a null check. */
interface LiveRef<T> {
  current: T;
}

export interface FileCacheDeps {
  target: FileEditorTarget | null;
  loadedRef: LiveRef<Set<string>>;
  bumpRevision: () => void;
  setContents: (update: (previous: Record<string, string>) => Record<string, string>) => void;
  setBaselines: (update: (previous: Record<string, string>) => Record<string, string>) => void;
  setLineEndings: (update: (previous: Record<string, LineEnding>) => Record<string, LineEnding>) => void;
  setMtimes: (update: (previous: Record<string, number | null>) => Record<string, number | null>) => void;
  setHashes: (update: (previous: Record<string, string | null>) => Record<string, string | null>) => void;
}

export interface FileCache {
  /**
   * Store one read's bytes in EVERY cache: the LF buffer, its baseline, the
   * ending it arrived with, the mtime it was read at, and the content hash the
   * disk watcher compares against.
   */
  remember: (fileKey: string, text: string, mtimeMs: number | null, hash: string | null) => void;
  /** Re-read every cached file; a re-render cannot skip a key already marked read. */
  reset: () => void;
  /** Drop every cache entry for a tab that is no longer open. */
  retain: (ids: Array<number | string>) => void;
  /** Change the ending the NEXT save writes. */
  setEol: (eol: LineEnding) => void;
}

export function useFileCache({
  target,
  loadedRef,
  bumpRevision,
  setContents,
  setBaselines,
  setLineEndings,
  setMtimes,
  setHashes,
}: FileCacheDeps): FileCache {
  const remember = useCallback(
    (fileKey: string, text: string, mtimeMs: number | null, hash: string | null) => {
      // The buffer holds LF only; the style the bytes arrived with is kept beside
      // it so the write can put the file back the way it was found.
      const ending = detectLineEnding(text);
      const lf = toLf(text);
      setContents((previous) => ({ ...previous, [fileKey]: lf }));
      setBaselines((previous) => ({ ...previous, [fileKey]: lf }));
      setLineEndings((previous) => ({ ...previous, [fileKey]: ending }));
      setMtimes((previous) => ({ ...previous, [fileKey]: mtimeMs }));
      setHashes((previous) => ({ ...previous, [fileKey]: hash }));
    },
    [setContents, setBaselines, setLineEndings, setMtimes, setHashes],
  );

  const reset = useCallback(() => {
    loadedRef.current.clear();
    bumpRevision();
  }, [loadedRef, bumpRevision]);

  const retain = useCallback(
    (ids: Array<number | string>) => {
      const keep = new Set(ids.map(String));
      for (const loaded of Array.from(loadedRef.current)) {
        if (!keep.has(loaded)) loadedRef.current.delete(loaded);
      }
      setContents((previous) => retainKeys(previous, keep));
      setBaselines((previous) => retainKeys(previous, keep));
      setLineEndings((previous) => retainKeys(previous, keep));
      setMtimes((previous) => retainKeys(previous, keep));
      setHashes((previous) => retainKeys(previous, keep));
    },
    [loadedRef, setContents, setLineEndings, setMtimes, setHashes],
  );

  // Only the ending moves: the BUFFER is LF-only either way, and the bytes are
  // built at write time, so nothing on screen changes and no re-read is needed.
  const setEol = useCallback(
    (next: LineEnding) => {
      if (!target) return;
      setLineEndings((previous) => ({ ...previous, [editorTargetKey(target)]: next }));
    },
    [target, setLineEndings],
  );

  return { remember, reset, retain, setEol };
}
