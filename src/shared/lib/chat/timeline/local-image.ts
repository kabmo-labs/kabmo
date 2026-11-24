/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Local image references written as markdown.
 *
 * An agent that generated a picture answers with
 * `![alt](/Users/me/project/shot.png)` or `![alt](file:///Users/me/shot.png)`.
 * Both are paths on the machine running the console, not URLs the browser can
 * fetch: a root-relative path is requested from the app's origin (`/Users/…`
 * → 404) and a `file://` URL is refused outright. The timeline therefore marks
 * them at render time and lets the session's image route serve the bytes.
 *
 * Only references that name an image are touched, and never one that already
 * names an app route (`/api/…`), a remote URL or a `data:`/`blob:` payload.
 * The sanitizer drops a `file:` URL from `src`, so that spelling is first
 * normalized to the path it names; the marker itself is added AFTER
 * sanitization, which is also why it needs no sanitizer allow-list entry.
 */

import { pathFromFileUrl } from '@/shared/lib/fs/file-url';

/** The attribute the renderer marks a local image with. */
export const LOCAL_IMAGE_ATTR = 'data-local-image';

/** The session route that serves a marked reference's bytes. */
export function sessionImageUrl(sessionId: string, reference: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/local-image?path=${encodeURIComponent(reference)}`;
}

/** Extensions the session image route serves; the raster set, no SVG. */
const IMAGE_EXTENSION_RE = /\.(?:png|jpe?g|gif|webp|avif|bmp|ico)$/i;

/** `&amp;` and friends are how a markdown URL reaches the HTML attribute. */
function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** Attribute values are injected as HTML, so `&` and `"` must be entities. */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * The path an `<img src>` names on this machine, or null when it is a URL the
 * browser (or the document pipeline) must keep.
 *
 * A relative path is returned unchanged; the session image route resolves it
 * against the session's cwd, which is what a `![](docs/hero.png)` in an agent
 * answer means.
 */
export function localImageReference(source: string): string | null {
  const raw = decodeHtmlAttribute(source.trim());
  if (!raw) return null;

  const fromFileUrl = pathFromFileUrl(raw);
  if (fromFileUrl) return IMAGE_EXTENSION_RE.test(fromFileUrl) ? fromFileUrl : null;

  // A drive letter is a path, not a scheme (`C:` is one letter).
  if (/^[A-Za-z]:[\\/]/.test(raw)) return IMAGE_EXTENSION_RE.test(raw) ? raw : null;

  // A scheme, a protocol-relative host or an in-page anchor is not a file.
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(raw)) return null;
  // An app route already points at bytes the console knows how to serve.
  if (raw.startsWith('/api/')) return null;

  // `.`/`..` in a relative reference is ordinary; the route resolves it under
  // the session cwd and refuses anything that escapes.
  return IMAGE_EXTENSION_RE.test(raw) ? raw : null;
}

/**
 * Rewrite a `file://` image `src` to the path it names, before sanitization.
 *
 * DOMPurify removes a `file:` URL (it is not in the default URI allow-list), so
 * a local picture written that way would reach the marker pass with no src at
 * all. A root-relative path is the sanitizer-safe spelling, and the marker pass
 * turns it into the session image URL next.
 */
export function localizeFileImageSources(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) =>
    tag.replace(/(\s)src="(file:\/\/[^"]*)"/i, (attribute, space: string, value: string) => {
      const reference = localImageReference(value);
      if (!reference) return attribute;
      return `${space}src="${escapeAttribute(reference)}"`;
    }),
  );
}

/**
 * Move every local image `src` to {@link LOCAL_IMAGE_ATTR}. Fenced code is
 * already escaped by the renderer, so `src="` inside a code block is not an
 * attribute.
 */
export function markLocalImageSources(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) =>
    tag.replace(/(\s)src="([^"]*)"/i, (attribute, space: string, value: string) => {
      const reference = localImageReference(value);
      if (!reference) return attribute;
      return `${space}${LOCAL_IMAGE_ATTR}="${escapeAttribute(reference)}"`;
    }),
  );
}
