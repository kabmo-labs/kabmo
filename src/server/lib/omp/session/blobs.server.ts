/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Blob reference resolution for persisted session images.
 *
 * omp keeps an image's bytes out of the session JSONL once they are large: the
 * entry stores a content-addressed reference (`blob:sha256:<hash>`) and the raw
 * bytes live in the blob store (`$OMP_AGENT_DIR/blobs/<hash>`, an XDG-aware
 * path — see `getBlobStoreDir`). Verified against omp 18.2.10:
 * `pi-coding-agent/src/session/blob-store.ts` is the producer, and only omp's
 * own loader (`session-loader.ts:resolveBlobRefs`) resolves the refs back on
 * read.
 *
 * Nothing in Kabmo did that, so a reloaded session rendered
 * `data:image/png;base64,blob:sha256:…` — a data URL whose payload is the ref
 * string, which no browser can decode. The timeline showed a broken image and
 * opening it dumped the ref as text.
 *
 * Resolution is confined to the blob store: the suffix must be a canonical
 * 64-char lowercase hex digest, so a crafted ref cannot escape the directory
 * (the same guard omp applies in `parseBlobRef`).
 */

import * as fsp from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { getAgentDir } from '@/server/lib/omp/core/paths';
import { getImageMimeFromBytes, getImageMimeType } from '@/shared/lib/fs/file-kind';

const BLOB_PREFIX = 'blob:sha256:';

/** Canonical blob hash shape; anything else is rejected before touching the fs. */
const BLOB_HASH_RE = /^[a-f0-9]{64}$/;

/** True when `value` is a content-addressed blob reference. */
export function isBlobRef(value: string): boolean {
  return value.startsWith(BLOB_PREFIX);
}

/**
 * The blob store directory. Mirrors omp's `getBlobsDir()`: `<agentDir>/blobs`,
 * relocated to `$XDG_DATA_HOME/omp/blobs` when omp is running the XDG layout
 * (which drops the `agent/` prefix). The existing-directory probe decides which
 * layout is live, because omp's own switch is opt-in and file-based.
 */
export function getBlobStoreDir(): string {
  const xdgDataHome = Bun.env.XDG_DATA_HOME;
  if (xdgDataHome) {
    const xdgPath = path.join(xdgDataHome, 'omp', 'blobs');
    if (existsSync(xdgPath)) return xdgPath;
  }
  return path.join(getAgentDir(), 'blobs');
}

/**
 * Read a blob's raw bytes, or null when the ref is malformed or the blob is
 * gone (a pruned store, a session copied between machines). A missing blob is
 * not an error the caller can act on — the caller falls back to showing the
 * attachment without a preview.
 */
export async function readBlob(hash: string): Promise<Buffer | null> {
  if (!BLOB_HASH_RE.test(hash)) return null;
  try {
    return await fsp.readFile(path.join(getBlobStoreDir(), hash));
  } catch {
    return null;
  }
}

/** Read the bytes behind a `blob:sha256:<hash>` reference, or null. */
export async function readBlobRef(ref: string): Promise<Buffer | null> {
  if (!isBlobRef(ref)) return null;
  return readBlob(ref.slice(BLOB_PREFIX.length));
}

/** Extensions omp writes onto a blob's hardlink beside it (`mimeToExtension`). */
const BLOB_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'tiff', 'ico'];

/**
 * A blob's bytes plus the content type to serve them with, or null when the
 * ref is malformed or the blob is gone.
 *
 * The MIME type is resolved from the BYTES first and from the sibling link
 * second, because omp stores the blob under its content hash and the extension
 * lives only on a hardlink beside it — a store whose links were pruned still
 * has the bytes, and a wrong `content-type` makes a browser download the image
 * instead of painting it. `image/jpeg` is the honest answer for a `.png` that
 * omp converted on read (measured: a 96×96 PNG read came back as a JPEG blob).
 */
export async function readBlobImage(hash: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const bytes = await readBlob(hash);
  if (!bytes) return null;

  const sniffed = getImageMimeFromBytes(bytes);
  if (sniffed) return { bytes, mimeType: sniffed };

  const dir = getBlobStoreDir();
  for (const ext of BLOB_IMAGE_EXTENSIONS) {
    if (!existsSync(path.join(dir, `${hash}.${ext}`))) continue;
    const byExtension = getImageMimeType(`x.${ext}`);
    if (byExtension) return { bytes, mimeType: byExtension };
  }

  return { bytes, mimeType: 'application/octet-stream' };
}
