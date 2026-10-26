/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The editor panel's tab-level bookkeeping, as one hook.
 *
 * Two effects that both answer "what does the TAB STRIP need to know", and both are
 * easy to get wrong on their own:
 *
 * - **Which tabs hold unsaved edits.** The editor is the only component that caches
 *   the buffers, so it is the only one that can answer; the strip draws the dot, the
 *   close guard asks before closing, and the unload prompt arms itself. Only FILE
 *   tabs are published — a diff tab and an attachment chip have no file behind them,
 *   so "unsaved" means nothing there.
 * - **The default preview mode for a rendered file.** A markdown page, a CSV grid and
 *   an SVG open in their RENDERED form, because that is what the user opened them to
 *   read. The default is seeded only when nothing was stored, so a user who switched
 *   to source keeps that choice.
 */

import { useEffect } from 'preact/hooks';

import { RENDERED_VIEWERS, viewerKindFor } from '@/shared/lib/fs/document-kind';
import { getSessionValue } from '@/shared/lib/workspace/session-state/store';
import { setDirtyTabs } from '@/client/lib/editor-dirty-tabs';
import type { OpenedFile } from '@/shared/types/fs';

interface UseEditorTabStateOptions {
  openedFiles: OpenedFile[];
  /** Buffer keys holding edits that are not on disk (from `useFileEditor`). */
  dirtyKeys: ReadonlySet<string>;
  activeFile: OpenedFile | undefined;
  /** The session store has loaded, so a stored choice can be read. */
  previewReady: boolean;
  setPreviewMode: (update: (previous: Record<string | number, boolean>) => Record<string | number, boolean>) => void;
  sessionId: string | null;
}

export function useEditorTabState({
  openedFiles,
  dirtyKeys,
  activeFile,
  previewReady,
  setPreviewMode,
  sessionId,
}: UseEditorTabStateOptions): void {
  useEffect(() => {
    const ids = new Set(
      openedFiles.filter((file) => !file.isDiff && file.content === undefined).map((file) => file.id),
    );
    setDirtyTabs([...dirtyKeys].filter((key) => ids.has(key)));
  }, [dirtyKeys, openedFiles]);

  useEffect(() => {
    if (!previewReady) return;
    const id = activeFile?.id;
    if (!activeFile || id === undefined || id === null) return;
    // Only a file with a RENDERED view has a default worth setting; a code file has
    // no preview to open.
    if (!RENDERED_VIEWERS[viewerKindFor(activeFile.name)]) return;
    const stored = getSessionValue<Record<string | number, boolean>>(sessionId, 'editor.previewMode');
    if (stored && stored[id] !== undefined) return;
    setPreviewMode((previous) => (previous[id] === undefined ? { ...previous, [id]: true } : previous));
    // `previewMode` is deliberately absent: the effect seeds a MISSING entry, and
    // re-running it because the map moved would re-seed the file the user just
    // switched to source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewReady, activeFile]);
}
