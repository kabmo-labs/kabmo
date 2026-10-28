/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * OS file drag-and-drop for the chat composer.
 *
 * Three browser rules shape this module:
 *
 * 1. A `drop` is only delivered when the preceding `dragover` was cancelled, so
 *    the handlers belong on the whole composer card — a drop aimed at the
 *    textarea bubbles up to it, and cancelling there also suppresses the
 *    browser's own "insert the dropped file's path as text" default.
 * 2. A dropped DIRECTORY is not a readable File: `dataTransfer.files` carries a
 *    size-0 stub for it. Only `DataTransferItem.webkitGetAsEntry()` reveals it
 *    as a directory, so those are walked recursively and attached file by file.
 * 3. A file dropped anywhere the app does not cancel lands in the tab as
 *    `file://` navigation, which throws Kabmo away. The guard below is
 *    window-wide for exactly that reason; it only ever cancels file drags, so
 *    text and URL drops keep their native behaviour.
 *
 * What counts as a file drag is decided in `drop-payload.ts`, because hosts
 * disagree: a download dragged out of a web page offers no File at all, only a
 * URL, and those references are handed back to the caller to resolve.
 *
 * The drag data store is cleared the moment the drop handler returns, so every
 * store-bound read (`getAsFile`, `webkitGetAsEntry`, `getData`) happens
 * synchronously; the entries and Files they return stay valid while the walk
 * awaits.
 */

import { useCallback, useEffect, useRef } from 'preact/hooks';
import type { TargetedDragEvent } from 'preact';
import { collectDroppedFileUris, hasDraggedFiles } from '@/client/hooks/chat/composer/drop-payload';
import { useDragPresence } from '@/client/hooks/ui/drag-presence';
import { primeFileReads, primedPrefix } from '@/client/hooks/chat/composer/file-reads';
import type { PrimedReads } from '@/client/hooks/chat/composer/file-reads';
import {
  expandDroppedFiles,
  readDroppedEntries,
  MAX_DROP_DEPTH,
  MAX_DROPPED_FILES,
} from '@/client/hooks/chat/composer/drop-entries';
import type { DroppedEntries } from '@/client/hooks/chat/composer/drop-entries';

/** Reason shown when a drop yielded more than the composer can take. */
export const DROP_LIMIT_NOTICE =
  `Some files were skipped — a drop is limited to ${MAX_DROPPED_FILES} files and ${MAX_DROP_DEPTH} folder levels deep.`;

export interface UseFileDropOptions {
  /**
   * Called once per drop with every file it resolved to (directories expanded),
   * plus any file REFERENCES the host offered instead of bytes (a download
   * dragged out of a web page) for the caller to resolve server-side.
   */
  onFiles: (files: File[], incomplete: boolean, references: string[], primed: PrimedReads) => void;
  /** While true a drop is cancelled but not attached — the composer is closed. */
  disabled?: boolean;
}

/** Drag handlers to spread onto the drop target. */
export interface FileDropProps {
  onDragEnter: (e: TargetedDragEvent<HTMLElement>) => void;
  onDragOver: (e: TargetedDragEvent<HTMLElement>) => void;
  onDragLeave: (e: TargetedDragEvent<HTMLElement>) => void;
  onDrop: (e: TargetedDragEvent<HTMLElement>) => void;
}

export interface UseFileDropResult {
  /** True while a file drag hovers the bound element (drives the overlay). */
  isDragging: boolean;
  dropProps: FileDropProps;
}

export function useFileDrop({ onFiles, disabled = false }: UseFileDropOptions): UseFileDropResult {
  // `relatedTarget`-based, not a counter: `dragenter` fires for every nested
  // child the pointer crosses (the card's toolbar, the textarea, the attachment
  // chips), so a counter rose with each crossing while a matching `dragleave` to
  // a node still inside was ignored — and the overlay stayed on after the
  // pointer left. See `useDragPresence`.
  const presence = useDragPresence();
  // Latest callback and flag behind refs, so the handlers stay referentially
  // stable and the window guard sees the current `disabled`.
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  // Files dropped anywhere else would navigate the tab to `file://` and discard
  // Kabmo, so the default is cancelled app-wide. This runs after the
  // composer's own drop handler (the event bubbles up to window), by which point
  // that handler has already read the data store it needed.
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (hasDraggedFiles(e.dataTransfer)) e.preventDefault();
    };
    window.addEventListener('dragover', guard);
    window.addEventListener('drop', guard);
    return () => {
      window.removeEventListener('dragover', guard);
      window.removeEventListener('drop', guard);
    };
  }, []);

  const onDragEnter = useCallback((e: TargetedDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (disabledRef.current) return;
    presence.enter();
  }, [presence]);

  const onDragOver = useCallback((e: TargetedDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    // Required: without it the browser refuses the drop and navigates to the
    // file instead of handing it to the app.
    e.preventDefault();
    // Every `dragover` here is proof the pointer is over the card; a child
    // crossing fires the enter/leave pair in between, and this re-asserts the
    // overlay without counting anything.
    if (!disabledRef.current) presence.enter();
    if (!e.dataTransfer) return;
    // `none` is the only cursor that tells the truth about a closed composer.
    e.dataTransfer.dropEffect = disabledRef.current ? 'none' : 'copy';
  }, [presence]);

  // Not gated on the payload: `dataTransfer.types` can already be empty on
  // dragleave. `useDragPresence.leave` is the gate.
  const onDragLeave = useCallback((e: TargetedDragEvent<HTMLElement>) => {
    presence.leave(e);
  }, [presence]);

  const onDrop = useCallback((e: TargetedDragEvent<HTMLElement>) => {
    const dt = e.dataTransfer;
    // Read the payload in ONE pass before anything else touches it:
    // `getAsFile()` and `webkitGetAsEntry()` are not pure accessors on a
    // file-manager drag, and each call can consume state the other needs.
    const entries: DroppedEntries = dt ? readDroppedEntries(dt) : { files: [], directories: [], fallbacks: new Map() };
    const references = dt ? collectDroppedFileUris(dt) : [];

    if (!dt || !hasDraggedFiles(dt)) return;
    e.preventDefault();
    presence.clear();
    if (disabledRef.current) return;

    // START THE READS NOW, in the drop handler's own tick. A dropped File's
    // read permission is released when this handler returns, and a read started
    // afterwards fails permanently — the chip rendered with the right name and
    // size while its contents never arrived, on every retry. `FileReader` takes
    // the permission at call time, so starting here is what makes the bytes
    // reachable; the pipeline only awaits these later.
    const primed = primeFileReads(entries.files, entries.fallbacks);

    if (entries.files.length === 0 && entries.directories.length === 0) {
      // No File at all: the host named the file without handing it over, and the
      // reference resolver is the only route left to its contents.
      if (references.length > 0) onFilesRef.current([], false, references, primed);
      return;
    }

    void expandDroppedFiles(entries).then(async ({ files: resolved, incomplete }) => {
      const carries = resolved.length > 0 ? await carriesBytes(resolved, primed) : false;
      // A File that carries bytes is attached directly. Deciding from metadata
      // instead — "size 0 and no type, so it must be a path stub" — misread a
      // real file whose size the browser had not filled in, and sent it to the
      // reference resolver, which only reads inside the allow-list. The file
      // was then refused with no way for the user to tell why. Bytes settle it.
      if (resolved.length > 0 && carries) {
        onFilesRef.current(resolved, incomplete, [], primed);
        return;
      }
      if (references.length > 0) {
        onFilesRef.current([], incomplete, references, primed);
        return;
      }
      // Files that declare no bytes are attached as-is; the attachment hook
      // reports the ones that never produced content.
      if (resolved.length > 0) onFilesRef.current(resolved, incomplete, [], primed);
    });
  }, [presence]);

  return { isDragging: presence.active, dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}

/**
 * Whether any dropped file actually holds bytes.
 *
 * A promised file (another app's drag) reports `size: 0` until its contents
 * land, so the check reads rather than trusting the declared size. One readable
 * file is enough: the batch is attached as a unit, and a member that stays
 * empty is reported by the attachment hook rather than by re-routing the whole
 * drop.
 */
export async function carriesBytes(files: File[], primed?: PrimedReads): Promise<boolean> {
  const sample = files.slice(0, 4);
  const results = await Promise.all(sample.map(async (file) => {
    if (file.size > 0) return true;
    // A stub declaring no size is settled by its bytes — read from the primed
    // prefix where the drop provided one, because a `slice()` started after the
    // drop window closes is not authorized to read a dropped file at all.
    const bytes = await primedPrefix(file, primed);
    if (bytes !== undefined) return bytes.byteLength > 0;
    try {
      const raw = await file.slice(0, 1).arrayBuffer();
      return raw.byteLength > 0;
    } catch {
      return false;
    }
  }));
  return results.some(Boolean);
}
