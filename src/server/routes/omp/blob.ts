/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/omp/blob?hash=<sha256>` — the bytes behind a `blob:sha256:` image
 * reference, read out of omp's blob store.
 *
 * A `read` of an image answers with the picture itself, and omp externalizes
 * anything large to a content-addressed store rather than keeping the base64 in
 * the session JSONL (measured on this install: 421 of 435 image blocks in the
 * session files are refs). The timeline therefore has a reference, not bytes,
 * and must ask the server that owns the store.
 *
 * The hash is validated by `readBlob`'s canonical-digest guard before it ever
 * reaches a path join, so a crafted value cannot escape the store directory.
 * `nosniff` plus an explicit content type, because the bytes are the model's
 * own output rendered by the same origin — a blob that turned out to be HTML
 * must not be interpreted as such.
 */

import { json, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { errorResponse } from '@/server/lib/route-adapter';
import { readBlobImage } from '@/server/lib/omp/session/blobs.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const hash = new URL(request.url).searchParams.get('hash');
  if (!hash) {
    return json({ error: 'Missing hash' }, { status: 400 });
  }

  try {
    const image = await readBlobImage(hash);
    if (!image) {
      return json({ error: 'Blob not found' }, { status: 404 });
    }

    // `no-store`: a session copied between machines can replace the bytes under
    // the same hash only by colliding, but a 404'd blob that later appears —
    // a store restored from a backup — must not stay broken for the life of
    // the tab.
    return new Response(image.bytes, {
      headers: {
        'content-type': image.mimeType,
        'content-length': String(image.bytes.byteLength),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
