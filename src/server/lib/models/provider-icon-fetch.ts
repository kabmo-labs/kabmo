/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fetching a provider's own web icon, bounded in every direction.
 *
 * A `models.yml` provider's host is the only identity its row has, so the
 * site's favicon is the only logo available for it. Three rules, each a way
 * this goes wrong:
 *
 * - **The icon is declared, not guessed.** `/favicon.ico` is the LAST resort
 *   (see `provider-icon-parse.ts` for the ranking).
 * - **The bytes are sniffed, never trusted.** A "favicon" that answers
 *   `text/html` is a 404 page or a login wall; storing and painting it would be
 *   a broken image in the list.
 * - **Every fetch is bounded** — 4s per request, 512 KiB per body, a handful of
 *   candidates — because the caller is a settings panel and the host is a
 *   stranger.
 */

import { getImageMimeFromBytes } from '@/shared/lib/fs/file-kind';
import { looksLikeSvg, pickIconHrefs, providerOrigin } from '@/server/lib/models/provider-icon-parse';

/** Per-request ceiling. A favicon slower than this is not worth the wait. */
const FETCH_TIMEOUT_MS = 4_000;
/** Body ceiling. Measured real favicons: 1-40 KiB; 512 KiB is generous. */
const MAX_BODY_BYTES = 512 * 1024;
/** How many declared candidates to try before falling back to `/favicon.ico`. */
const MAX_CANDIDATES = 4;

/** A browser-shaped UA: some hosts answer a bare `Bun/x.y` with a 403. */
const USER_AGENT = 'Mozilla/5.0 (compatible; Kabmo/1.0; +provider-icon)';

export interface ProviderIconBytes {
  bytes: Uint8Array;
  mime: string;
  /** The URL the bytes actually came from — kept for the stored record. */
  source: string;
}

async function fetchBounded(url: string, accept: string): Promise<Response | null> {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return response.ok ? response : null;
  } catch {
    // no-excuse-ok: catch — a host that is down, blocked or slow is a miss, and
    // the caller's answer (fall back to the built-in mark) is the same for all.
    return null;
  }
}

async function readCapped(response: Response): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.byteLength > MAX_BODY_BYTES || bytes.byteLength === 0 ? null : bytes;
}

/**
 * One URL → icon bytes, or null when the answer is not a picture.
 *
 * The type is decided from the BYTES first: hosts routinely mislabel a favicon
 * (`text/plain` for an ICO is common), and an `<img>` still paints a
 * mislabelled image, while a `text/html` 404 page must never be stored as one.
 */
export async function fetchIconAt(url: string): Promise<ProviderIconBytes | null> {
  const response = await fetchBounded(url, 'image/*,image/svg+xml;q=0.9,*/*;q=0.1');
  if (!response) return null;
  const bytes = await readCapped(response);
  if (!bytes) return null;
  const declared = (response.headers.get('content-type') ?? '').toLowerCase();
  // Cheap rejection first: an HTML answer is a page, not a picture.
  if (declared.includes('text/html')) return null;
  if (looksLikeSvg(bytes)) return { bytes, mime: 'image/svg+xml', source: url };
  const sniffed = getImageMimeFromBytes(bytes);
  if (sniffed) return { bytes, mime: sniffed, source: url };
  // A declared image type with no magic match (a format the table does not
  // know) is still worth serving: the browser decides what it can paint.
  if (declared.startsWith('image/')) return { bytes, mime: declared.split(';')[0].trim(), source: url };
  return null;
}

/** The document at `origin/`, or null when it cannot be read. */
async function fetchOriginHtml(origin: string): Promise<string | null> {
  const response = await fetchBounded(origin, 'text/html,*/*;q=0.8');
  if (!response) return null;
  const bytes = await readCapped(response);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

/**
 * The best icon a provider's site offers, or null when it offers none Kabmo can
 * use. Never throws: a provider without an icon is a normal state (a private
 * gateway, a host behind auth), and the caller falls back to its own mark.
 */
export async function fetchProviderIcon(baseUrl: string | undefined): Promise<ProviderIconBytes | null> {
  const origin = providerOrigin(baseUrl);
  if (!origin) return null;

  const html = await fetchOriginHtml(origin);
  if (html) {
    for (const candidate of pickIconHrefs(html, origin, MAX_CANDIDATES)) {
      const icon = await fetchIconAt(candidate);
      if (icon) return icon;
    }
  }
  // Last resort: the root ICO every web server has served since 1999.
  return fetchIconAt(`${origin}/favicon.ico`);
}
