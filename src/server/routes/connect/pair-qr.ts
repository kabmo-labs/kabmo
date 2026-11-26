/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/connect/pair/qr.png?pairingId=…` — the current pairing code as a
 * downloadable PNG.
 *
 * A real HTTP response rather than a Blob the page builds, because a DOWNLOAD is
 * not something every host can do from JavaScript: Android's shell hands an
 * `http` URL to `DownloadManager` (and silently ignores a `blob:` one), iOS's
 * shell turns a non-renderable response into a `WKDownload`, and the desktop
 * shells hand the file to their webview's own download path. A PNG served from
 * this origin is the one shape all of them agree on, and it also means the file
 * the user opens is a real image rather than an SVG their viewer cannot show.
 *
 * Gated like every other API route. The requesting host carries the console's
 * session cookie — `DownloadManager` and `WKDownload` both do — so the image is
 * not readable without the session that minted it.
 */

import type { LoaderFunctionArgs } from '@kabmo-labs/kabmo-http';
import { pairingQr } from '@/server/lib/connect/pairing.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const pairingId = new URL(request.url).searchParams.get('pairingId') ?? '';
  const png = pairingId === '' ? null : pairingQr(pairingId);
  if (!png) {
    return new Response('This pairing code has expired or was already used.', {
      status: 410,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return new Response(png, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'content-disposition': 'attachment; filename="kabmo-pairing-qr.png"',
      'content-length': String(png.byteLength),
      'cache-control': 'no-store',
    },
  });
}
