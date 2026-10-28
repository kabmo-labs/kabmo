/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Dev asset proxy — the one place Bun's own asset routes fall short.
 *
 * In development Bun bundles `index.html` itself and answers the assets it emits
 * from its own routing table (`/_bun/client/*`, `/_bun/asset/*`), before a
 * request can reach Elysia. Those responses carry an `ETag` but ignore
 * `If-None-Match`, carry no `Cache-Control`, and are never compressed — so every
 * page load re-downloads the whole unminified bundle. Measured on Bun 1.4.2, a
 * 19.7 MB dev bundle answered `200` with all 19,755,962 bytes to a request that
 * sent its own ETag back, and again with `Accept-Encoding: gzip, br, zstd` (no
 * `content-encoding`). The same server with `development: false` answers `304`
 * and `Cache-Control: public, max-age=31536000, immutable`, which is exactly why
 * production is cheap and development was not.
 *
 * Bun's table wins for the paths it declares, so a route on `/_bun/*` cannot
 * shadow them (verified: a `routes` entry for `/_bun/client/*` is never
 * reached). The shell is therefore rewritten to a prefix this server owns, and
 * this module serves the bytes back from the listener — adding the two headers
 * Bun omits.
 *
 * Why `no-cache` rather than `immutable`: the JS bundle's name is a build
 * generation id that changes on every rebuild, but the CSS asset names are NOT
 * content-addressed — appending a rule to `tailwind.css` changed the bytes
 * served at the same `/_bun/asset/<hash>.css` URL (verified). `immutable` there
 * would pin stale styles for a year. `no-cache` plus a content `ETag` is correct
 * for both: the browser stores the body and revalidates, so an unchanged asset
 * costs one 304 instead of a re-download.
 *
 * Development only. Production assets are content-hashed and already answered
 * with a working `304` and `immutable` — by Bun's own table in runtime mode and
 * by `plugins/static.ts` from a build — so neither needs this.
 */

import { notModified } from '@/server/lib/assets/conditional.server';
import { maybeCompress } from '@/server/plugins/compress';

/** Whether the proxy is active at all. See the module comment. */
export const DEV_ASSETS_ENABLED = Bun.env.NODE_ENV !== 'production';

/** Bun's own dev asset prefix — its routing table owns every path under it. */
const BUN_ASSET_PREFIX = '/_bun/';

/**
 * The asset kinds worth proxying.
 *
 * `/_bun/hmr` (the WebSocket) and `/_bun/unref` (a visibility beacon) stay on
 * Bun's table: neither is a page-load byte, and proxying them would put a socket
 * upgrade and a POST through here for nothing.
 */
const ASSET_KINDS = ['/_bun/client/', '/_bun/asset/'] as const;

/** The prefix this server answers instead. Underscored, so it cannot collide. */
export const DEV_ASSET_PREFIX = '/_dev-assets/';

/** Cache policy: store the body, revalidate every time. See the module comment. */
const DEV_ASSET_CACHE = 'no-cache';

/** `/_bun/client/x.js` -> `/_dev-assets/client/x.js`, in the shell markup. */
export function rewriteDevAssetUrls(html: string): string {
  let out = html;
  for (const kind of ASSET_KINDS) {
    out = out.replaceAll(kind, DEV_ASSET_PREFIX + kind.slice(BUN_ASSET_PREFIX.length));
  }
  return out;
}

/** `/_dev-assets/client/x.js` -> `/_bun/client/x.js`, or null when not ours. */
export function devAssetUpstreamPath(pathname: string): string | null {
  if (!pathname.startsWith(DEV_ASSET_PREFIX)) return null;
  const upstream = BUN_ASSET_PREFIX + pathname.slice(DEV_ASSET_PREFIX.length);
  return ASSET_KINDS.some((kind) => upstream.startsWith(kind)) ? upstream : null;
}

/**
 * The response for a dev asset request, or null when the path is not one.
 *
 * `base` is the listener's own URL: the bytes are fetched back from it because
 * Bun's bundle is in memory and its routing table — not Elysia's — owns the
 * `/_bun/*` paths.
 */
export async function serveDevAsset(
  request: Request,
  pathname: string,
  base: URL,
  fetchOptions: RequestInit = {},
): Promise<Response | null> {
  const upstream = devAssetUpstreamPath(pathname);
  if (!upstream) return null;

  // `fetchOptions` carries the TLS bypass under `--tls`: this is the server
  // fetching from its own self-signed listener.
  const response = await fetch(new URL(upstream, base), fetchOptions);
  const type = response.headers.get('content-type') ?? '';
  // An asset name that no longer exists falls through Bun's table to the SSR
  // catch-all and comes back as the shell markup. Serving that as JavaScript
  // would fail far from its cause, so it is reported here instead.
  if (!response.ok || type.startsWith('text/html')) {
    return new Response(`No dev asset at ${upstream}\n`, {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const etag = `"${Bun.hash(bytes).toString(16)}"`;
  // The same decision the file route makes, so a dev asset and a built one
  // revalidate identically. `lastModifiedMs` is null: there is no file behind
  // these bytes, only the hash above, so the date branch does not apply.
  if (notModified(request, etag, null)) {
    return new Response(null, { status: 304, headers: { etag, 'cache-control': DEV_ASSET_CACHE } });
  }

  return maybeCompress(
    new Response(bytes, {
      headers: {
        'content-type': type || 'application/octet-stream',
        'cache-control': DEV_ASSET_CACHE,
        etag,
      },
    }),
    request.headers.get('accept-encoding'),
  );
}
