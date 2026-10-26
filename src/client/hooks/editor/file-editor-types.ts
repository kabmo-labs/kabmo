/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The file-editing contract's own types.
 *
 * Split out of `use-file-editor.ts` for the repository's per-file ceiling, and they
 * belong here anyway: the phone's full-screen editor, the desktop pane and the
 * write path all name these, and importing a type from a hook module couples them
 * to an implementation file.
 */

export type FileEditorSaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'needs-permission';

import type { ViewerKind } from '@/shared/lib/fs/document-kind';
import type { LineEnding } from '@/shared/lib/code/line-endings';
import type { ByteSource } from '@/client/components/workspace/editor/viewers/bytes';

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
  /**
   * The ACTIVE buffer's own line ending, which the next save restores.
   *
   * Detected from the bytes on read, never from a setting: a CRLF file must stay
   * CRLF, and the buffer itself is LF-only so this is the only place the style
   * survives.
   */
  eol: LineEnding;
  /**
   * Change the ending the NEXT save writes.
   *
   * A UI over an existing capability: the write path has always carried `eol` (a
   * multipart body normalizes bare LF, so the ending cannot ride in the payload). What
   * was missing was a way to CHOOSE it — a file that arrived as CRLF stayed CRLF and
   * one that arrived as LF stayed LF, with no way to convert either.
   */
  setEol: (eol: LineEnding) => void;
  /**
   * The mtime the ACTIVE buffer was read at, or null when it has none (an inline
   * attachment, a handle-backed file, a read that failed).
   *
   * The conflict guard sends it as `baseMtime` and the change watcher compares the
   * disk against it.
   */
  baseMtimeMs: number | null;
  /**
   * EVERY cached buffer holding edits that are not on disk — not just the active
   * one.
   *
   * `isDirty` answers for the tab on screen, which is all a single hook can see;
   * the tab strip needs the answer for the tab the user is about to CLOSE, and a
   * background buffer is exactly what `isDirty` cannot describe. Keys are the
   * buffer keys, which for an opened tab is `String(tab.id)`.
   */
  dirtyKeys: ReadonlySet<string>;
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
  /**
   * Which surface draws this file (see `shared/lib/fs/document-kind`). The pane
   * dispatches on it, and `isImage` is now one case of it rather than its own
   * axis.
   */
  viewerKind: ViewerKind;
  /**
   * The bytes a byte-drawing viewer reads, from the tab's path or its live
   * handle. `loadBytes` is null for a text viewer and for an inline attachment
   * (nothing to fetch); `url` is additionally null when the file came from a
   * handle rather than a workspace path.
   */
  byteSource: ByteSource;
  /**
   * True for the viewers that read BYTES rather than the text buffer (image,
   * PDF, DOCX, workbook). Their read path is skipped and their writes refused,
   * because a byte surface has no buffer to save.
   */
  isBinaryViewer: boolean;
  /**
   * Bumped by `reset()` (a workspace refresh). A byte viewer that fetches its
   * own bytes has no read effect to re-run, so it takes this as its re-read
   * lever; the text path already re-reads through `useFileRead`.
   */
  revision: number;
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
  /**
   * The disk copy moved since this buffer was read, so the last write was refused.
   *
   * `null` for the active file means there is no conflict to report. The panel
   * offers two answers — reload the disk copy, or write over it — because
   * reporting it as a failed save would leave the user with no way forward.
   */
  conflict: { diskMtimeMs: number | null } | null;
  /** Take the disk copy, discarding the buffer's edits. */
  resolveConflictByReload: () => void;
  /**
   * Write the buffer anyway, adopting the disk mtime as the new base.
   *
   * This is the "Keep mine" answer: the user has seen that the disk moved and
   * chosen their buffer over it.
   */
  resolveConflictByKeepingMine: () => void;
  /**
   * Throw the buffer away and take the file from disk.
   *
   * The user-facing Revert. Distinct from `reset()` (a workspace refresh, which
   * deliberately KEEPS a dirty buffer) and from `resolveConflictByReload` only in
   * that it needs no conflict to exist — the reason to revert is usually that the
   * user wants the disk copy back, not that anyone else wrote it.
   */
  revertToDisk: () => void;
  /**
   * Adopt the disk's mtime as this buffer's base WITHOUT writing anything.
   *
   * The answer to an external-change notice when the user wants to keep editing:
   * their next save must not be refused with a `409` over a change they have
   * already been shown and accepted. Nothing is written here — the buffer stays
   * dirty and the autosave owns the write.
   */
  adoptDiskMtime: (diskMtimeMs: number) => void;
}
