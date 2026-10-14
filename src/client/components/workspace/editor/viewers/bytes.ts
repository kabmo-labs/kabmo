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

import { fileHandleFor } from '@/client/lib/launch/file-handlers';

export interface ByteSource {
  /** Stable identity of the file these bytes come from. */
  id: string;
  /** Raw-byte URL, for consumers that take a URL (`<img>`, `<iframe>`). */
  url: string | null;
  /** Fetch the bytes, for consumers that parse them (docx, workbook). */
  loadBytes: (() => Promise<ArrayBuffer>) | null;
}

/** A source with nothing behind it — an inline attachment, or a target with no path. */
export const NO_BYTE_SOURCE: ByteSource = { id: '', url: null, loadBytes: null };

/**
 * The byte source for a tab, or `NO_BYTE_SOURCE` when it has neither a path nor
 * a live handle (an inline attachment chip — nothing to fetch).
 */
export function byteSourceFor(target: {
  path?: string;
  handleId?: string;
  rawUrl: string | null;
}): ByteSource {
  if (target.rawUrl) {
    const url = target.rawUrl;
    return {
      id: url,
      url,
      loadBytes: async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Could not read the file (HTTP ${res.status}).`);
        return res.arrayBuffer();
      },
    };
  }
  const handle = fileHandleFor(target.handleId);
  if (handle) {
    return {
      id: target.handleId as string,
      url: null,
      loadBytes: async () => (await handle.getFile()).arrayBuffer(),
    };
  }
  return NO_BYTE_SOURCE;
}
