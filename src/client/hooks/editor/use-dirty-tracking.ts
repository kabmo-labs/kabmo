/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which open files have unsaved edits.
 *
 * Two sources, one answer: the TEXT buffers (a buffer that differs from the
 * baseline it was read at) and the BINARY documents (a workbook whose draft
 * lives in the viewer's own store, so all this side keeps is a flag). The dirty
 * set is DERIVED from those two rather than tracked separately — a second copy
 * would be a second thing to keep in step, and the comparison is a string
 * identity check per open buffer.
 *
 * Split out of `use-file-editor.ts` so that file stays under the repo's
 * per-file ceiling; the text comparison stays with the caller because it owns
 * the buffer and its line-ending normalization.
 */

import { useCallback, useMemo, useState } from 'preact/hooks';
import { editorTargetKey as targetKey } from '@/client/hooks/editor/target-key';
import type { FileEditorTarget } from '@/client/hooks/editor/file-editor-types';

interface Options {
  target: FileEditorTarget | null;
  /** The active file's cache key, `''` when nothing is open. */
  key: string;
  /** Whether the active TEXT buffer differs from its baseline. */
  textDirty: boolean;
  contents: Record<string, string>;
  baselines: Record<string, string>;
  /** Drops the caches of tabs that are no longer open — see `useFileCache`. */
  retain: (ids: Array<number | string>) => void;
}

export function useDirtyTracking({ target, key, textDirty, contents, baselines, retain }: Options) {
  /**
   * Files whose BINARY document (a workbook) holds unsaved edits.
   *
   * Kept beside the text caches rather than inside them because the value is a
   * flag, not a buffer: the edited workbook itself lives in the viewer's draft
   * store, and this set is what the tab strip and the close guard read.
   */
  const [binaryDirtyKeys, setBinaryDirtyKeys] = useState<ReadonlySet<string>>(() => new Set());

  const isDirty = textDirty || binaryDirtyKeys.has(key);

  const dirtyKeys = useMemo(() => {
    const next = new Set<string>(binaryDirtyKeys);
    for (const [bufferKey, text] of Object.entries(contents)) {
      const baseline = baselines[bufferKey];
      if (baseline !== undefined && text !== baseline) next.add(bufferKey);
    }
    return next;
  }, [contents, baselines, binaryDirtyKeys]);

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

  return { isDirty, dirtyKeys, setBinaryDirty, retain: retainAll };
}
