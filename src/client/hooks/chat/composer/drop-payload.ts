/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reading a drop's payload.
 *
 * Every host describes a dragged file differently, and the differences decide
 * whether a drop is accepted at all:
 *
 * - A file manager (Finder, Explorer, Nautilus) exposes real `File` entries.
 *   macOS additionally attaches a `text/plain` item carrying the absolute path,
 *   so the item list holds a `string` entry beside the `file` one.
 * - A browser page dragging a DOWNLOAD (WhatsApp Web, Gmail, Slack) has no File
 *   at all: it offers a URL in `DownloadURL` / `text/uri-list`. Gating on the
 *   `Files` type rejected those outright, which is why a file dragged out of
 *   WhatsApp never attached.
 * - VS Code's explorer offers only proprietary types whose payloads must be
 *   parsed for paths.
 *
 * These helpers answer the three questions the composer asks of a
 * `DataTransfer`, and are pure so they can be exercised without a browser.
 *
 * `getData` throws in some hosts when called during `dragover` rather than
 * `drop`; every read is guarded so one unreadable type cannot abort the scan.
 */


/** Data types that, by their presence alone, mean files are being dragged. */
const FILE_BEARING_TYPES = ['files', 'text/uri-list', 'codefiles', 'downloadurl'];

/** Types whose payload is a path or URL to resolve, not a readable File. */
const PATH_BEARING_TYPES = ['text/uri-list', 'downloadurl', 'text/plain', 'codefiles'];

/** Data type marking a drag that started in Kabmo's own file tree. */
export const INTERNAL_FILE_PATH_TYPE = 'application/x-kabmo-file-path';

/**
 * Read one declared type's payload.
 *
 * `getData` is case-sensitive while the format names hosts use are not: Chrome
 * reports `downloadurl` in `types` after a page set `DownloadURL`, and a
 * lowercase lookup misses it. The declared list is the ground truth, so the
 * requested type is matched against it first and the host's own spelling is used
 * for the read.
 */
function readData(dataTransfer: DataTransfer, type: string): string {
  try {
    const declared = dataTransfer.types ? Array.from(dataTransfer.types) : [];
    const match = declared.find((candidate) => candidate.toLowerCase() === type.toLowerCase());
    return match ? dataTransfer.getData(match) : '';
  } catch {
    return '';
  }
}

/**
 * Whether this drag carries files at all — the gate for showing the drop target
 * and for cancelling the browser's own handling.
 *
 * Checked on dragenter/dragover, where payloads are often unreadable, so the
 * declared types are the primary signal and the file list is the fallback for
 * hosts that declare nothing useful. A `text/plain` payload is NOT accepted on
 * its own: that would make every text selection a drop target.
 */
export function hasDraggedFiles(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) {
    return false;
  }
  if (dataTransfer.files && dataTransfer.files.length > 0) {
    return true;
  }

  const types = dataTransfer.types ? Array.from(dataTransfer.types).map((type) => type.toLowerCase()) : [];
  if (FILE_BEARING_TYPES.some((type) => types.includes(type))) {
    return true;
  }
  if (types.some((type) => type.includes('vnd.code.tree'))) {
    return true;
  }

  // A path-bearing type only counts when its payload looks like a path or URL:
  // `text/plain` alone is how every text selection arrives, and treating that as
  // a file drag would make the drop target light up for ordinary prose.
  const references = collectDroppedFileUris(dataTransfer);
  return references.length > 0;
}

/** True for a payload that is a path or URL rather than a document body. */
function looksLikeFileReference(value: string): boolean {
  const candidate = value.trim();
  if (!candidate || candidate.includes('\n')) return false;
  if (/^(file|https?):\/\/\S+$/i.test(candidate)) return true;
  // A POSIX absolute path, a `~` path, or a Windows drive path.
  return /^(~\/|\/|[A-Za-z]:[\\/])\S*$/.test(candidate);
}

/**
 * File references from a drop that carries no `File` objects — a download
 * dragged out of a web page, or VS Code handing over paths.
 *
 * macOS puts up to two payloads on the same drag: a `text/uri-list` with a
 * `file://` URL and a `text/plain` with the bare path. `file://` wins outright
 * when present, because the bare path is the same file spelled less precisely —
 * collecting both would attach one file twice.
 */
export function collectDroppedFileUris(dataTransfer: DataTransfer | null | undefined): string[] {
  if (!dataTransfer || typeof dataTransfer.getData !== 'function') return [];

  const references: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const candidate = value.trim();
    // A uri-list is newline-separated and may carry `#` comments.
    for (const line of candidate.split('\n')) {
      const entry = line.trim();
      if (!entry || entry.startsWith('#') || !looksLikeFileReference(entry)) continue;
      if (seen.has(entry)) continue;
      seen.add(entry);
      references.push(entry);
    }
  };

  for (const type of PATH_BEARING_TYPES) {
    if (type === 'text/plain' && references.length > 0) continue;
    add(readData(dataTransfer, type));
  }
  return references;
}
