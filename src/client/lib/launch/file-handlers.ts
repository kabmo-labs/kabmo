/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Opening a file the operating system handed to Kabmo.
 *
 * This is the PWA File Handling path, and it is a different shape from every
 * other way a file reaches the editor. A drop, a link or the file tree names a
 * PATH, which the server reads through `/api/fs/read` and writes through
 * `/api/fs/action`. A launch gives a `FileSystemFileHandle` instead — a live
 * capability onto the file with NO path the server can reach. So the bytes are
 * read in the BROWSER and written back through the handle, and the handle
 * itself is the only thing that can save the file.
 *
 * Three consequences, each load-bearing:
 *
 * 1. **The handle cannot be persisted.** A `FileSystemFileHandle` is not
 *    structured-cloneable into `session_ui_state`, so the registry below is a
 *    module-level map that dies with the page. A tab opened this way therefore
 *    shows a banner after a reload explaining that reopening is what restores
 *    saving — the alternative was a Save button that silently did nothing.
 *
 * 2. **A handle-backed tab must never fall through to the path-based save.**
 *    Its `path` is only a display name, so `POST /api/fs/action` would resolve
 *    that name against the default root and write to an unrelated file. The
 *    write path branches on `handleId` and refuses when the handle is gone.
 *
 * 3. **The same classification runs here as on the server.** A binary or
 *    oversized file is refused with the shared sentence before a tab opens,
 *    because there is no route to answer that question for a handle.
 */

import { BINARY_SNIFF_BYTES, classifyEditorFile, unsupportedEditorMessage } from '@/shared/lib/fs/file-kind';
import { openFileInEditor } from '@/client/hooks/ui/open-file';
import type { LaunchParams } from '@/client/lib/launch/types';

/**
 * Live handles, keyed by the id a tab carries.
 *
 * A module-level map rather than component state: the editor reads it at SAVE
 * time, from a debounced timer that outlives the render that opened the tab.
 * Deliberately NOT on `globalThis` — unlike the database handle, nothing here
 * outlives a page, and a reload SHOULD drop it (see the module note).
 */
const handles = new Map<string, FileSystemFileHandle>();

let nextHandleId = 0;

/** The live handle for a tab's `handleId`, or null once the page has reloaded. */
export function fileHandleFor(handleId: string | undefined): FileSystemFileHandle | null {
  if (!handleId) return null;
  return handles.get(handleId) ?? null;
}

/** Whether this browser can be a file handler at all (Chromium desktop only). */
export function fileHandlingSupported(): boolean {
  return typeof window !== 'undefined' && 'launchQueue' in window;
}

export interface LaunchedFileResult {
  ok: boolean;
  message: string;
}

/**
 * Register a handle and open a tab for it.
 *
 * Shared by the PWA launch path and the drag-drop path, because a file dragged
 * from Finder is the SAME shape: a live `FileSystemFileHandle` with no
 * server-reachable path. The id's prefix records where it came from (a log
 * detail), nothing more.
 *
 * The handle is registered BEFORE the tab opens, so the tab's first Save can
 * already find it — registering afterwards left a window in which a fast edit
 * would be refused as "no handle".
 */
export async function openHandleAsTab(
  handle: FileSystemFileHandle,
  origin: 'launch' | 'drop',
): Promise<LaunchedFileResult> {
  let file: File;
  try {
    file = await handle.getFile();
  } catch {
    return { ok: false, message: `Could not read ${handle.name}.` };
  }

  const head = new Uint8Array(await file.slice(0, BINARY_SNIFF_BYTES).arrayBuffer());
  const kind = classifyEditorFile({ path: file.name, size: file.size, head });
  if (kind === 'binary' || kind === 'too-large') {
    return { ok: false, message: unsupportedEditorMessage(kind, file.size, file.name) };
  }

  // A picture and a document are opened like any other file: the handle id is
  // registered below, and the editor's byte source reads the bytes through it —
  // an object URL for the surfaces that take a URL (`<img>`, `<iframe>`), the
  // `ArrayBuffer` for the ones that parse. That is what makes a dropped PDF or
  // PNG work without a server path, which the previous version refused outright.
  //
  // Only a TEXT file is read into the buffer here: a document's bytes can be
  // megabytes, and reading them into a string would corrupt them anyway.
  const handleId = `${origin}-${nextHandleId++}`;
  handles.set(handleId, handle);
  const content = kind === 'text' ? await file.text() : undefined;
  openFileInEditor({ path: file.name, name: file.name, content, handleId });
  return { ok: true, message: `Opened ${file.name}` };
}

/** Open a file the OS handed to Kabmo at launch. */
export function openLaunchedHandle(handle: FileSystemFileHandle): Promise<LaunchedFileResult> {
  return openHandleAsTab(handle, 'launch');
}

/**
 * What a write through a handle did.
 *
 * Three answers because the caller must tell two very different situations
 * apart: a write that happened, a write the browser refused, and a write that
 * needs the user to grant access first — and only the last one is fixed by
 * clicking Save.
 */
export type HandleWriteResult = 'written' | 'needs-permission' | 'failed';

/**
 * Write a tab's buffer back through its handle.
 *
 * **The permission step is the whole point, and it is why this is not a bare
 * `createWritable`.** A handle from a DROP (and from a launch) starts at
 * `readwrite: "prompt"` — measured on Chrome for macOS: `queryPermission({
 * mode:'read' })` is `"granted"` while `queryPermission({ mode:'readwrite' })`
 * is `"prompt"` — and `createWritable()` REFUSES while the state is `prompt`.
 * So a Save without this silently did nothing: the button showed `saved` and
 * the file on disk never changed.
 *
 * `interactive` is the second half, and it exists because the grant needs a
 * USER GESTURE. A click on Save (or Ctrl+S) is one; the debounced AUTOSAVE is
 * not — it fires from a timer, where `requestPermission` is refused outright
 * (spec: "User activation is required") or, worse, leaves a prompt hanging. So
 * a non-interactive write reports `needs-permission` instead of asking, and the
 * surface turns that into "click Save to grant access" rather than a failed
 * save. After the first granted Save the state is `granted` and the autosave
 * proceeds normally.
 */
export async function writeThroughHandle(
  handleId: string,
  text: string,
  options: { interactive: boolean },
): Promise<HandleWriteResult> {
  const handle = handles.get(handleId);
  if (!handle) return 'failed';
  try {
    if (typeof handle.queryPermission === 'function') {
      const state = await handle.queryPermission({ mode: 'readwrite' });
      if (state !== 'granted') {
        // No gesture means no prompt: report what the user has to do.
        if (!options.interactive) return 'needs-permission';
        if (typeof handle.requestPermission !== 'function') return 'failed';
        const granted = await handle.requestPermission({ mode: 'readwrite' });
        if (granted !== 'granted') return 'failed';
      }
    }
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return 'written';
  } catch {
    return 'failed';
  }
}

/**
 * Install the launch consumer, once per page.
 *
 * `setConsumer` is invoked for EVERY launch, including ones that happened
 * before the script ran (the queue holds them), so the call is what makes a
 * cold start from a double-clicked file work at all. The guard is for a second
 * call after an HMR reload, which would otherwise stack consumers.
 */
export function installFileLaunchHandler(
  onResult?: (result: LaunchedFileResult) => void,
): () => void {
  if (!fileHandlingSupported()) return () => {};

  const queue = window.launchQueue;
  if (!queue || typeof queue.setConsumer !== 'function') return () => {};

  queue.setConsumer((launchParams: LaunchParams) => {
    for (const handle of launchParams.files ?? []) {
      // Only file handles: a launch can also carry a directory handle, which
      // the editor has no tab for.
      if (typeof (handle as FileSystemFileHandle).getFile !== 'function') continue;
      void openLaunchedHandle(handle as FileSystemFileHandle).then((result) => onResult?.(result));
    }
  });

  return () => {
    // `setConsumer(null)` clears it, which is what an unmount wants — leaving
    // the previous consumer installed would open into a torn-down tree.
    queue.setConsumer(null);
  };
}
