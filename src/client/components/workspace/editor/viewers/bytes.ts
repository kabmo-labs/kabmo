/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The bytes a byte-drawing viewer reads, from wherever the tab can reach them.
 *
 * Two sources, one shape, because a tab has two possible origins:
 *
 * - a path inside a workspace, fetched from `/api/fs/raw` (the same route the
 *   image viewer already uses, so the scope resolution is identical);
 * - a file the OS handed over (a drop, a PWA launch), which has NO
 *   server-reachable path — only a live `FileSystemFileHandle` — so its bytes
 *   come from `handle.getFile()`.
 *
 * `id` is the file's IDENTITY, and it is what the loaders' effects key on. It
 * cannot be `loadBytes` (a fresh closure on every render, which would re-parse
 * the document on every render) nor `url` alone (null for a handle-backed file,
 * so two different dropped files would look like one). It is the tab's handle id
 * or its raw URL, both of which change only when the file does.
 *
 * The loaders are lazy (`() => Promise`) rather than eager bytes: a PDF or a
 * workbook can be megabytes, and a viewer that is never opened must cost
 * nothing. Each viewer calls `loadBytes()` once per `id`.
 *
 * A returned `ArrayBuffer` is always a fresh copy per call (`fetch` and
 * `getFile()` both hand one out), so a parser may detach or transfer it without
 * breaking a second read.
 */

import { deviceFileFor } from '@/client/lib/launch/device-files';
import { fileHandleFor } from '@/client/lib/launch/file-handlers';
import { getRawContentType } from '@/shared/lib/fs/file-kind';

export interface ByteSource {
  /** Stable identity of the file these bytes come from. */
  id: string;
  /** Raw-byte URL, for consumers that take a URL (`<img>`, `<iframe>`). */
  url: string | null;
  /** Fetch the bytes, for consumers that parse them (docx, workbook). */
  loadBytes: (() => Promise<ArrayBuffer>) | null;
  /**
   * The file's MIME type, or null when its kind has none.
   *
   * Load-bearing for the consumers that build an object URL: a `blob:` URL's
   * `Content-Type` comes from the Blob it was made from, and a Blob with no
   * type serves an EMPTY one. Chrome's PDF plugin reads that header to decide
   * whether to initialize, so a dropped PDF wrapped in an untyped Blob renders
   * as an empty frame — measured: the typed blob got the
   * `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai` viewer frame and the
   * untyped one got nothing. A workspace file never hits this (its `url` is
   * `/api/fs/raw`, which already carries the header), which is why only the
   * handle-backed path was broken.
   */
  mimeType: string | null;
}

/** A source with nothing behind it — an inline attachment, or a target with no path. */
export const NO_BYTE_SOURCE: ByteSource = { id: '', url: null, loadBytes: null, mimeType: null };

/**
 * The reason in a refusal body, or a generic sentence when the body is not JSON.
 *
 * `/api/fs/raw` answers a file past its ceiling with `415` and
 * `{ error: "This file is 21.00 MB — larger than the 20.00 MB the editor opens." }`,
 * and that sentence is the whole point of the refusal — a viewer that reported
 * only "HTTP 415" would describe the status code instead of the reason. Shared
 * by `loadBytes` here and by `useByteUrl`'s probe, because both can meet the
 * same refusal and must word it the same way.
 */
export async function readRefusalReason(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === 'string' && body.error
    ? body.error
    : `Could not read the file (HTTP ${res.status}).`;
}

/**
 * The byte source for a tab, or `NO_BYTE_SOURCE` when it has neither a path nor
 * a live handle (an inline attachment chip — nothing to fetch).
 */
export function byteSourceFor(target: {
  path?: string;
  handleId?: string;
  rawUrl: string | null;
}): ByteSource {
  // Derived from the PATH, which for a handle-backed tab is the file's own name
  // (see `openHandleAsTab`) — so a dropped `report.pdf` gets `application/pdf`
  // and the object URL the viewer builds from it initializes.
  const mimeType = getRawContentType(target.path);
  if (target.rawUrl) {
    const url = target.rawUrl;
    return {
      id: url,
      url,
      mimeType,
      loadBytes: async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(await readRefusalReason(res));
        return res.arrayBuffer();
      },
    };
  }
  // The device registry comes first: a document a PHONE handed over has no
  // handle and no server path — its bytes were pushed into the page by the
  // shell (`client/lib/launch/device-files.ts`), and that map is the only copy.
  const delivered = deviceFileFor(target.handleId);
  if (delivered) {
    const { bytes } = delivered;
    return {
      id: target.handleId as string,
      url: null,
      mimeType: delivered.mimeType ?? mimeType,
      // A fresh `ArrayBuffer` per call, like every other source here: a parser
      // may detach or transfer it, and the registry must survive a second read.
      loadBytes: async () => bytes.slice().buffer as ArrayBuffer,
    };
  }
  const handle = fileHandleFor(target.handleId);
  if (handle) {
    return {
      id: target.handleId as string,
      url: null,
      mimeType,
      loadBytes: async () => (await handle.getFile()).arrayBuffer(),
    };
  }
  return NO_BYTE_SOURCE;
}
