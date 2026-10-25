/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dropping a file on the editor opens it, instead of attaching it to the chat.
 *
 * Two shapes of drop arrive, and BOTH must open a file:
 *
 * 1. **A file from Finder.** Measured on Chrome for macOS: such a drag declares
 *    `types: ["Files"]` and nothing else — no `text/uri-list`, no `text/plain` —
 *    so `getData()` yields NO path, and `dataTransfer.files` is empty for the
 *    whole drag and only filled at `drop` (with a read-only `File`). The only
 *    route to a writable file is `DataTransferItem.getAsFileSystemHandle()`,
 *    which is populated from the first `dragenter`.
 * 2. **A path or URL** handed over by a page (VS Code, a browser download) as
 *    `text/uri-list` / `text/plain`. That resolves through `/api/fs/scope`,
 *    because a path can be written back through the server.
 *
 * 3. **A Finder drag onto a DESKTOP SHELL's webview.** Neither of the above
 *    exists there: WebKit implements no `getAsFileSystemHandle` (WebKit bug
 *    257792) and puts no path on the pasteboard the page can read, so a drop
 *    carried bytes and nothing else and the editor refused it. The shell reads
 *    the pasteboard itself and hands the paths over — see
 *    `client/lib/desktop/dropped-paths`.
 *
 * Handles are tried FIRST: they are the shape that carries write access, and a
 * host that offers both (a Finder drag onto a page that also set a URI list)
 * should keep it. The shell's paths come next — they resolve to a real path,
 * which is what the editor saves through.
 *
 * The overlay's state is a depth COUNTER, and it is reset by a window-level
 * `dragend`/`drop` too — a drag that ends outside the element (Escape, released
 * over another window) fires no matching `dragleave`, and a counter left above
 * zero made the NEXT drag's overlay look stuck.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { TargetedDragEvent } from 'preact';
import { collectDroppedFileUris, hasDraggedFiles } from '@/client/hooks/chat/composer/drop-payload';
import { openHandleAsTab } from '@/client/lib/launch/file-handlers';
import { readShellDroppedPaths } from '@/client/lib/desktop/dropped-paths';
import { openFileInEditor } from '@/client/hooks/ui/open-file';

/** What `/api/fs/scope` answers with. */
interface FileScope {
  root?: string;
  path?: string;
  name?: string;
  kind?: 'image' | 'document' | 'text' | 'binary' | 'too-large';
  error?: string;
}

export interface EditorDropResult {
  ok: boolean;
  message: string;
}

export interface UseEditorDropOptions {
  /** False when the column has no workspace to resolve against. */
  enabled?: boolean;
  /** A refusal or a successful open, reported by the host (a toast). */
  onResult?: (result: EditorDropResult) => void;
}

export interface EditorDropProps {
  onDragEnter: (e: TargetedDragEvent<HTMLElement>) => void;
  onDragOver: (e: TargetedDragEvent<HTMLElement>) => void;
  onDragLeave: (e: TargetedDragEvent<HTMLElement>) => void;
  onDrop: (e: TargetedDragEvent<HTMLElement>) => void;
}

/**
 * Handlers that must run BEFORE a code surface sees the drag.
 *
 * CodeMirror handles `drop` itself, on its own `contentDOM`: for a drag carrying
 * FILES it reads each file's text and INSERTS it into the document, then calls
 * `preventDefault` — so the panel's own drop handler saw `defaultPrevented` and
 * stood down. Measured in the browser: dropping `b.ts` on an open `a.ts` put
 * `DROPPED_CONTENT` at the top of the buffer (and the autosave then wrote it to
 * disk), while the overlay had promised "Drop a file to open it".
 *
 * A capture-phase listener on the panel is what wins that race, because capture
 * runs from the outermost element inward — the surface's own handler has not run
 * yet. It claims ONLY a drag that is over a code surface (`[data-code-surface]`,
 * set by `CodeSurface`), so a drop on the composer still belongs to the composer
 * and a drop on the chat's own chrome still reaches `onDrop` as before.
 */
export interface EditorDropCaptureProps {
  onDropCapture: (e: TargetedDragEvent<HTMLElement>) => void;
}

/** The attribute a code surface marks itself with, for the capture handler. */
export const CODE_SURFACE_ATTRIBUTE = 'data-code-surface';

export interface UseEditorDropResult {
  isDragging: boolean;
  dropProps: EditorDropProps;
  /** Spread on the same element as `dropProps`. */
  captureDropProps: EditorDropCaptureProps;
}

/**
 * Whether any item in this drag can be opened as a file handle.
 *
 * A `kind: 'file'` item with `getAsFileSystemHandle` is the signal — it is
 * present from `dragenter`, which is what lets the target accept the drag
 * before `dataTransfer.files` is populated.
 */
function hasDroppedHandles(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer?.items) return false;
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind === 'file' && typeof item.getAsFileSystemHandle === 'function') return true;
  }
  return false;
}

/** Whether this drag is something the editor can open, by either shape. */
function isOpenableDrag(dataTransfer: DataTransfer | null | undefined): boolean {
  return hasDraggedFiles(dataTransfer) || hasDroppedHandles(dataTransfer);
}

/**
 * Resolve one dropped reference and open it.
 *
 * Used for the path/URL shape. A Finder drag never reaches here — it has no
 * path — so this is the fallback rather than the primary.
 */
async function openDroppedReference(
  reference: string,
  onResult: ((result: EditorDropResult) => void) | undefined,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/fs/scope?path=${encodeURIComponent(reference)}`);
  } catch {
    onResult?.({ ok: false, message: 'Could not reach the console to open that file.' });
    return;
  }

  const body = (await res.json().catch(() => null)) as FileScope | null;
  if (!res.ok || !body?.path || !body.root) {
    onResult?.({ ok: false, message: body?.error ?? `Could not open that file (HTTP ${res.status}).` });
    return;
  }

  // A file the editor cannot show is refused HERE, with the server's own
  // sentence, rather than opened as a tab whose whole content is that sentence.
  // A document (PDF/DOCX/XLSX) is NOT refused: its viewer fetches the bytes
  // itself, so it opens like any other file.
  if (body.kind === 'binary' || body.kind === 'too-large') {
    onResult?.({ ok: false, message: body.error ?? `${body.name ?? 'That file'} cannot be opened here.` });
    return;
  }

  openFileInEditor({ path: body.path, name: body.name, root: body.root });
  onResult?.({ ok: true, message: `Opened ${body.name ?? body.path}` });
}

/**
 * Open the first file handle a drop carries.
 *
 * Reads every item in ONE pass inside the drop handler's own tick: the drop's
 * data store is released when the handler returns, and a handle read afterwards
 * fails permanently — the same rule `primeFileReads` encodes for the composer.
 */
async function openDroppedHandle(
  dataTransfer: DataTransfer,
  onResult: ((result: EditorDropResult) => void) | undefined,
): Promise<boolean> {
  const items = Array.from(dataTransfer.items ?? []);
  for (const item of items) {
    if (item.kind !== 'file' || typeof item.getAsFileSystemHandle !== 'function') continue;
    let handle: FileSystemHandle | null = null;
    try {
      handle = await item.getAsFileSystemHandle();
    } catch {
      continue;
    }
    if (!handle || handle.kind !== 'file') continue;
    const result = await openHandleAsTab(handle as FileSystemFileHandle, 'drop');
    onResult?.(result);
    return true;
  }
  return false;
}

export function useEditorDrop({ enabled = true, onResult }: UseEditorDropOptions = {}): UseEditorDropResult {
  const [isDragging, setIsDragging] = useState(false);
  // dragenter/dragleave fire per nested child the pointer crosses, so a boolean
  // drops to false the moment the cursor moves from the pane onto a child.
  const depthRef = useRef(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const reset = useCallback(() => {
    depthRef.current = 0;
    setIsDragging(false);
  }, []);

  // A drag can end without reaching this element again — released over another
  // window, cancelled with Escape, or its source node unmounted mid-drag. The
  // element's own handlers have already run by the time these fire, so this only
  // clears state the drop handler did not. Without it a counter left above zero
  // made the next drag's overlay look stuck on, and a counter left BELOW zero
  // (see `onDragLeave`) made the next one never appear.
  useEffect(() => {
    window.addEventListener('dragend', reset);
    window.addEventListener('drop', reset);
    return () => {
      window.removeEventListener('dragend', reset);
      window.removeEventListener('drop', reset);
    };
  }, [reset]);

  const onDragEnter = useCallback((e: TargetedDragEvent<HTMLElement>) => {
    // A descendant already claimed this drag — the composer, whose own handler
    // runs first because it is deeper in the tree. Skipping the increment here
    // is safe ONLY because `onDragLeave` counts symmetrically; the two must
    // agree or the counter drifts negative and the overlay stops appearing.
    if (e.defaultPrevented) return;
    if (!isOpenableDrag(e.dataTransfer)) return;
    e.preventDefault();
    if (!enabledRef.current) return;
    depthRef.current += 1;
    setIsDragging(true);
  }, []);

  const onDragOver = useCallback((e: TargetedDragEvent<HTMLElement>) => {
    // A descendant claimed the drag — the composer, whose own handler runs first
    // because it is deeper in the tree. The workspace overlay must then HIDE,
    // or hovering the composer shows two drop targets at once ("Drop files to
    // attach" over "Drop a file to open it") for a gesture that will only do one
    // of them. The counter is left alone, so moving back off the composer
    // restores this overlay.
    if (e.defaultPrevented) {
      setIsDragging(false);
      return;
    }
    if (!isOpenableDrag(e.dataTransfer)) return;
    // Required, or the browser refuses the drop and navigates the tab to the
    // file. Cancelling here is also what claims the gesture from the composer's
    // window-level guard, which runs later in the bubble.
    e.preventDefault();
    e.stopPropagation();
    if (depthRef.current > 0) setIsDragging(true);
    if (!e.dataTransfer) return;
    e.dataTransfer.dropEffect = enabledRef.current ? 'copy' : 'none';
  }, []);

  /**
   * A `dragleave` that stays INSIDE the element is a move between children, not
   * an exit — and counting it is what made the overlay disappear while the
   * pointer was still over the workspace.
   *
   * The failure, measured: entering the workspace increments the counter, moving
   * onto the composer is claimed by the composer (`defaultPrevented`, so the
   * workspace does NOT increment), and moving back off the composer fires a
   * `dragleave` that bubbles up and DECREMENTS — the counter returns to zero and
   * the overlay turns off even though the pointer never left the workspace.
   *
   * `relatedTarget` is the element being entered, so `contains` is the exact
   * test. It can be null (a drag leaving the window), which the counter still
   * handles; the clamp at zero keeps a stray leave from going negative, because
   * a negative counter makes every later drag's `=== 0` test miss and the
   * overlay never appears again.
   */
  const onDragLeave = useCallback((e: TargetedDragEvent<HTMLElement>) => {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    if (depthRef.current === 0) return;
    depthRef.current -= 1;
    if (depthRef.current === 0) setIsDragging(false);
  }, []);

  /** Open what a drop carries — shared by the bubble and the capture paths. */
  const openDropped = useCallback((dt: DataTransfer | null) => {
    if (!dt) return;
    // The payload is read in THIS tick, before any await. A drop's data store is
    // released when the handler returns, so a `getData` issued after an IPC
    // round trip reads an empty string — measured on the shell's `dropped_paths`
    // call, which is exactly such a round trip.
    const references = collectDroppedFileUris(dt);
    // Handles first: they are the only shape that carries write access, and a
    // Finder drag on a Chromium webview has nothing else.
    void openDroppedHandle(dt, onResultRef.current).then(async (opened) => {
      if (opened) return;
      // Then the shell's own read of the pasteboard, which is the ONLY route a
      // WebKit webview offers: it has no file-system handle and no URI list, so
      // a Finder drop there carries bytes the editor cannot save. Asked only
      // when no handle won, and consumed by the shell, so one drop opens one
      // file.
      const shellPaths = await readShellDroppedPaths();
      const first = shellPaths[0] ?? references[0];
      if (!first) {
        onResultRef.current?.({
          ok: false,
          message: 'That drop carried no readable file — drop it on the composer to attach it instead.',
        });
        return;
      }
      // One open per gesture: the editor has a single active tab, so opening
      // several would leave the user on whichever resolved last.
      await openDroppedReference(first, onResultRef.current);
    });
  }, []);

  const onDrop = useCallback((e: TargetedDragEvent<HTMLElement>) => {
    // The composer claimed it: one gesture must not both open the file and
    // queue it as an attachment. `defaultPrevented` is the platform's own
    // signal for "someone deeper already handled this".
    if (e.defaultPrevented) return;
    if (!isOpenableDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    reset();
    if (!enabledRef.current || !e.dataTransfer) return;
    openDropped(e.dataTransfer);
  }, [openDropped, reset]);

  /**
   * Claim a file drop that is about to land on a code surface.
   *
   * Capture phase, so it runs before CodeMirror's own `drop` handler on the
   * `contentDOM` — that one reads a dropped file's TEXT and inserts it into the
   * document, which would silently rewrite the open file on the next autosave.
   * Scoped to `[data-code-surface]` so a drop anywhere else keeps the existing
   * behaviour, the composer's included.
   */
  const onDropCapture = useCallback((e: TargetedDragEvent<HTMLElement>) => {
    if (!isOpenableDrag(e.dataTransfer)) return;
    const target = e.target;
    if (!(target instanceof Element) || !target.closest(`[${CODE_SURFACE_ATTRIBUTE}]`)) return;
    e.preventDefault();
    e.stopPropagation();
    reset();
    if (!enabledRef.current || !e.dataTransfer) return;
    openDropped(e.dataTransfer);
  }, [openDropped, reset]);

  return {
    isDragging,
    dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
    captureDropProps: { onDropCapture },
  };
}
