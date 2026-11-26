/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether an SVG a provider's site serves can actually be painted.
 *
 * A favicon is untrusted XML, and the difference between "valid enough to keep"
 * and "decodable by a browser" is not academic: tokenharbor.ai ships
 *
 *   <!-- Plate colour matches --background (cream) ... -->
 *
 * and XML forbids `--` inside a comment. Chromium answers the `<img>` with
 * `EncodingError` and paints nothing, so the provider fell back to its initials
 * while the store happily reported `status = 'ok'`.
 *
 * The comment is not content, so it is removed; a document that still does not
 * parse as `<svg>` is REJECTED rather than stored, which lets the fetch layer
 * try the site's next declared icon instead.
 *
 * Server-only because validation uses Bun's XML parser. `looksLikeSvg` stays in
 * the shared module for the cheap byte check the client also needs.
 */

import { looksLikeSvg } from '@kabmo-labs/kabmo-fs/media/file-kind';

/** XML comments, well-formed or not — `--` inside one is what breaks decoding. */
const XML_COMMENT_RE = /<!--[\s\S]*?-->/g;

function isSvgDocument(source: string | Uint8Array): boolean {
  try {
    const root = Bun.XML.parse(source, { compact: false });
    return root.name.split(':').pop() === 'svg';
  } catch {
    // no-excuse-ok: catch — a document that does not parse is not an image; the
    // caller stores nothing and tries the next candidate.
    return false;
  }
}

/**
 * The bytes of an SVG a browser can decode, or null when it cannot.
 *
 * Valid input is returned as-is (same encoding, same bytes). Only a document
 * that fails to parse is re-encoded with its comments stripped, and only when
 * the stripped document parses — anything else is rejected.
 */
export function drawableSvg(bytes: Uint8Array): Uint8Array | null {
  if (!looksLikeSvg(bytes)) return null;
  // Pass the BYTES: Bun's parser honours a BOM or the declared encoding, which
  // a plain UTF-8 decode would already have mangled.
  if (isSvgDocument(bytes)) return bytes;
  const stripped = new TextDecoder().decode(bytes).replace(XML_COMMENT_RE, '');
  if (stripped.length === 0 || !isSvgDocument(stripped)) return null;
  return new TextEncoder().encode(stripped);
}
