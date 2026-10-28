/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A document the phone handed to Kabmo, delivered as BYTES.
 *
 * The desktop shells hand over a PATH and the server opens it, because the
 * server runs on the same machine. On a phone that is not true: Kabmo is a
 * client of a console that may be across the room or across the world, so a file
 * picked in the Files app or a "Open with → Kabmo" from Gmail exists only on the
 * DEVICE. The server cannot read it, and `/api/fs/grant` would be granting a
 * path on a machine that has never seen the file.
 *
 * So the shell reads the bytes and pushes them here, and the tab is
 * DEVICE-BACKED: it renders, and it cannot be written back (there is no path to
 * write to and no writable handle). That is the honest model — the same one a
 * PWA launch uses on a desktop, minus the handle — and the editor says so
 * instead of offering a Save that would fail.
 *
 * ## Why chunks
 *
 * `evaluateJavascript`/`evaluateJavaScript` take one STRING, and a document the
 * editor will accept reaches 20-32 MiB, which is ~27-43 MiB of base64. A single
 * call of that size is a multi-second main-thread stall on both platforms and
 * has no documented ceiling, so the shell announces the file and streams it:
 *
 *     __kabmoOpenFiles([{ id, name, mimeType, size }])
 *     __kabmoOpenChunk(id, base64, last)      // repeated; `last` closes it
 *
 * The page accumulates and only decodes when the final chunk arrives, so a
 * half-delivered file can never open as a truncated document.
 *
 * Both globals are plain functions rather than bridge commands, for the reason
 * `native/open-paths.ts` states: the shell needs no reply, and the console is
 * the only place a refusal can be read.
 */

import { BINARY_SNIFF_BYTES, classifyEditorFile, unsupportedEditorMessage } from '@/shared/lib/fs/file-kind';
import { openFileInEditor } from '@/client/hooks/ui/open-file';

/** What a shell announces before it sends any bytes. */
export interface DeviceFileMeta {
  /** Unique per delivery, so two files of one name do not collide. */
  id: string;
  name: string;
  mimeType?: string;
  size?: number;
}

/** Where one file went. */
export interface DeviceFileResult {
  name: string;
  ok: boolean;
  message: string;
}

/** The property a shell calls to announce files. */
export const DEVICE_FILES_PROPERTY = '__kabmoOpenFiles';

/** The property a shell calls with each chunk of base64. */
export const DEVICE_CHUNK_PROPERTY = '__kabmoOpenChunk';

/** Bytes of a file the phone opened, kept for the life of the page. */
interface DeviceBytes {
  name: string;
  mimeType: string | null;
  bytes: Uint8Array;
}

/**
 * The bytes a device-backed tab draws from, keyed by the tab's `handleId`.
 *
 * Module-level rather than `globalThis`: a device file cannot outlive the page
 * that received it (nothing can re-read it — the URI permission belongs to the
 * native intent), so a reload SHOULD lose it, exactly like a
 * `FileSystemFileHandle`. The tab keeps its name and says it must be reopened.
 */
const files = new Map<string, DeviceBytes>();

/** Files announced but not yet complete. */
const pending = new Map<string, { meta: DeviceFileMeta; parts: string[] }>();

/** The bytes for a device-backed tab, or null when this page did not receive them. */
export function deviceFileFor(id: string | undefined): DeviceBytes | null {
  if (!id) return null;
  return files.get(id) ?? null;
}

/** A MIME type from a file name, for the blob URL a viewer builds. */
function mimeFor(meta: DeviceFileMeta): string | null {
  if (meta.mimeType && meta.mimeType.includes('/')) return meta.mimeType;
  return null;
}

/**
 * Base64 → bytes.
 *
 * An explicit loop rather than `Uint8Array.from(atob(b64), c => c.charCodeAt(0))`:
 * the array-literal form allocates a 20-million-element intermediate for a
 * 20 MiB document and then copies it. One `Uint8Array` of the decoded length,
 * filled in place, is the same work with half the peak memory.
 */
export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

/**
 * Open one delivered file as a tab.
 *
 * The classification is the SAME one the drop path and the read route apply, so
 * a binary or an oversized document is refused with the shared sentence rather
 * than opened as a tab whose whole content is a refusal.
 */
function openDeliveredFile(meta: DeviceFileMeta, bytes: Uint8Array): DeviceFileResult {
  const kind = classifyEditorFile({
    path: meta.name,
    size: bytes.byteLength,
    head: bytes.subarray(0, BINARY_SNIFF_BYTES),
  });
  if (kind === 'binary' || kind === 'too-large') {
    return { name: meta.name, ok: false, message: unsupportedEditorMessage(kind, bytes.byteLength, meta.name) };
  }

  files.set(meta.id, { name: meta.name, mimeType: mimeFor(meta), bytes });

  // A text file is decoded here so the editor opens with a buffer; a document,
  // a picture or a grid keeps its bytes and its viewer fetches them from the
  // registry (`byteSourceFor`).
  const content = kind === 'text' ? new TextDecoder().decode(bytes) : undefined;
  openFileInEditor({
    path: meta.name,
    name: meta.name,
    content,
    handleId: meta.id,
    deviceFile: true,
  });
  return { name: meta.name, ok: true, message: `Opened ${meta.name}` };
}

/**
 * Install the two globals a shell calls, and open a tab per completed file.
 *
 * Idempotent: the properties are overwritten, and a second install replaces the
 * reporter rather than stacking one.
 */
export function installDeviceFiles(
  options: { onResult?: (results: DeviceFileResult[]) => void } = {},
): void {
  if (typeof window === 'undefined') return;
  const host = window as unknown as Record<string, unknown>;

  const report = options.onResult ?? ((results: DeviceFileResult[]) => {
    for (const result of results) {
      if (!result.ok) console.warn(`[kabmo] ${result.name}: ${result.message}`);
    }
  });

  host[DEVICE_FILES_PROPERTY] = (metas: unknown) => {
    if (!Array.isArray(metas)) return;
    for (const raw of metas) {
      if (typeof raw !== 'object' || raw === null) continue;
      const meta = raw as Partial<DeviceFileMeta>;
      if (typeof meta.id !== 'string' || !meta.id || typeof meta.name !== 'string' || !meta.name) continue;
      // Announced again (a retry, a second chunk sequence for one intent): the
      // accumulator restarts, because the earlier bytes belong to a delivery the
      // shell abandoned.
      pending.set(meta.id, { meta: { id: meta.id, name: meta.name, mimeType: meta.mimeType, size: meta.size }, parts: [] });
    }
  };

  host[DEVICE_CHUNK_PROPERTY] = (id: unknown, base64: unknown, last: unknown) => {
    if (typeof id !== 'string' || typeof base64 !== 'string') return;
    const entry = pending.get(id);
    if (!entry) return;
    entry.parts.push(base64);
    if (last !== true) return;

    pending.delete(id);
    const joined = entry.parts.join('');
    entry.parts = [];
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(joined);
    } catch {
      // Truncated or mis-encoded base64 is a broken delivery, not a broken
      // document: opening half of it would render a corrupt file.
      report([{ name: entry.meta.name, ok: false, message: `Could not read ${entry.meta.name} — the transfer was incomplete.` }]);
      return;
    }
    report([openDeliveredFile(entry.meta, bytes)]);
  };
}
