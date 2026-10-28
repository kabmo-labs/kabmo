/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reading a provider site's icon: which URL it declares, and whether the bytes
 * are really a picture.
 *
 * The panel's marks are hand-drawn shapes for the providers omp ships. A
 * `models.yml` entry has no such mark — nobody can draw a logo for a gateway the
 * user registered yesterday — so every one of those rows fell back to initials.
 * The endpoint's own host is the only identity that row has, and its favicon is
 * the only logo available for it.
 *
 * These are the decisions that go wrong silently, so they live here as pure
 * functions and are pinned by tests:
 *
 * - `/favicon.ico` is the LAST resort, not the first: a page that declares
 *   `<link rel="icon" sizes="192x192">` is offering a better picture than the
 *   16px ICO at the root.
 * - `mask-icon` is never used: it is a monochrome silhouette for Safari's pinned
 *   tabs, so painting it in a plate shows a solid blob.
 * - a `baseUrl` of `https://host/v1` resolves against the ORIGIN, because
 *   `https://host/v1/favicon.ico` is a 404 on nearly every gateway.
 */

/** The scheme+host a provider's endpoint lives on, or null when it has none. */
export function providerOrigin(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null;
  const trimmed = baseUrl.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // A bare host (`kenari.id`) is a common hand-typed value; give it https.
    if (!/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(trimmed)) return null;
    try {
      parsed = new URL(`https://${trimmed}`);
    } catch {
      return null;
    }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.origin;
}

/** One `<link>` tag's `rel`/`href`/`sizes`, as far as the markup states them. */
interface LinkTag {
  rel: string;
  href: string;
  sizes?: string;
}

const LINK_TAG_RE = /<link\b[^>]*>/gi;
const ATTR_RE = /([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/** Every `<link>` in a document, with its attributes lower-cased by name. */
export function readLinkTags(html: string): LinkTag[] {
  const tags: LinkTag[] = [];
  for (const match of html.matchAll(LINK_TAG_RE)) {
    const attributes: Record<string, string> = {};
    for (const attr of match[0].matchAll(ATTR_RE)) {
      attributes[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? '';
    }
    const rel = attributes.rel?.toLowerCase().trim();
    const href = attributes.href?.trim();
    if (!rel || !href) continue;
    tags.push({ rel, href, ...(attributes.sizes ? { sizes: attributes.sizes } : {}) });
  }
  return tags;
}

/**
 * How much one `<link>` is worth as a logo.
 *
 * Tiers rather than raw pixels: an SVG (`sizes="any"`) scales to any plate, an
 * `apple-touch-icon` is a large PNG by convention, and among fixed sizes the
 * bigger one wins. A pixel count alone ranked `any` BELOW `192x192`, which put
 * the smaller raster ahead of a vector — measured: the rule returned
 * `icon.png` for a page declaring both.
 */
function linkScore(rel: string, sizes: string | undefined): number {
  const rels = rel.split(/\s+/);
  const isApple = rels.includes('apple-touch-icon') || rels.includes('apple-touch-icon-precomposed');
  if (!isApple && /any/i.test(sizes ?? '')) return 1000;
  if (isApple) return 900;
  let best = 0;
  for (const part of (sizes ?? '').toLowerCase().split(/\s+/)) {
    const match = /^(\d+)x(\d+)$/.exec(part);
    if (match) best = Math.max(best, Number(match[1]));
  }
  // A declared size, however small, still beats a tag that states none.
  return best > 0 ? 100 + Math.min(best, 512) : 50;
}

/**
 * Candidate icon URLs, best first, resolved against `origin`.
 *
 * Ranking is by what the tag is worth: an `apple-touch-icon` is a large PNG by
 * convention, a plain `icon` with a big `sizes` beats a small one, and an
 * explicit size beats an unstated one.
 */
export function pickIconHrefs(html: string, origin: string, limit = 4): string[] {
  const scored: Array<{ url: string; score: number }> = [];
  for (const tag of readLinkTags(html)) {
    const rels = tag.rel.split(/\s+/);
    if (rels.includes('mask-icon')) continue;
    const isApple = rels.includes('apple-touch-icon') || rels.includes('apple-touch-icon-precomposed');
    const isIcon = rels.includes('icon');
    if (!isApple && !isIcon) continue;
    let url: string;
    try {
      url = new URL(tag.href, `${origin}/`).toString();
    } catch {
      continue;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) continue;
    scored.push({ url, score: linkScore(tag.rel, tag.sizes) });
  }
  scored.sort((left, right) => right.score - left.score);
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const entry of scored) {
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    urls.push(entry.url);
  }
  return urls.slice(0, limit);
}

/** True when the bytes are an SVG document (which no magic-byte table catches). */
export function looksLikeSvg(bytes: Uint8Array): boolean {
  // Decode only the head: an SVG's first tag is within the first few hundred
  // bytes even with a prolog and a long `<style>`.
  const head = new TextDecoder().decode(bytes.subarray(0, 2048)).trimStart();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
}
