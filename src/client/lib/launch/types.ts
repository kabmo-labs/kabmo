/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Launch Handler / File Handling API surface, declared here because the
 * DOM lib does not ship it.
 *
 * `Window.launchQueue` and `LaunchParams` are Chromium-only and were never
 * merged into TypeScript's `lib.dom.d.ts`, so every use would otherwise be an
 * unchecked cast. The surface is small and stable (Chrome 102+), so declaring
 * the two shapes is more honest than `as unknown as { launchQueue: … }` at each
 * call site.
 *
 * `setConsumer(null)` is part of the real signature — it is what clears a
 * consumer — and is declared because this module relies on it.
 */

export interface LaunchParams {
  /** The files a launch handed over. A directory launch carries handles too. */
  files: FileSystemHandle[];
}

export interface LaunchQueue {
  setConsumer(consumer: ((params: LaunchParams) => void) | null): void;
}

declare global {
  interface Window {
    launchQueue?: LaunchQueue;
  }

  /**
   * The File System Access drop path, absent from `lib.dom.d.ts` for the same
   * reason `launchQueue` is.
   *
   * This is the ONLY way to open a file dragged from Finder with write access:
   * measured on Chrome for macOS, such a drag declares `types: ["Files"]` and
   * NOTHING ELSE — no `text/uri-list`, no `text/plain` — so `getData()` yields
   * no path, and `dataTransfer.files` is empty during the whole drag and only
   * populated at `drop` (with a `File`, which is read-only). The handle is
   * populated from the first `dragenter`, so it is also what makes a drop
   * target able to accept the drag at all.
   */
  interface DataTransferItem {
    getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
  }

  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite';
  }

  /**
   * The permission pair, also missing from `lib.dom.d.ts`.
   *
   * These matter because a handle from a DROP is not writable by default:
   * measured on Chrome for macOS, `queryPermission({mode:'read'})` is
   * `"granted"` while `queryPermission({mode:'readwrite'})` is `"prompt"`, and
   * `createWritable()` REFUSES while the state is `prompt`. `requestPermission`
   * is what promotes it, and it needs a user gesture — see `writeThroughHandle`.
   */
  interface FileSystemHandle {
    queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  }
}
