/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Resolve a wiki page's own references to the wiki pages and assets they name.
 *
 * A wiki page is not a chat message: `[v1.6.0](change_logs/v1.6.0)` means that
 * page of the wiki, and `![](images/schema.png)` means the image in the wiki's
 * own repository — not in the project's. Neither resolves on its own: the panel
 * is an app route, so a relative URL would be requested from the server's own
 * origin (`/images/schema.png` → 404), and a wiki's images are not on the
 * project host at all.
 *
 * So each reference is rewritten to the endpoint that can serve it — through
 * `/api/wiki/asset`, which reads the blob out of the wiki's tree — and a LINK to
 * a page additionally carries the resolved wiki path in `data-wiki-path`, which
 * is what the panel turns back into in-panel navigation. A reference that is not
 * in the wiki's tree is left exactly as written, and the renderer's click
 * handler classifies it from the raw `href` — so a relative path that named no
 * page of this wiki stays inert instead of being mistaken for an external URL
 * (which is what opened a browser tab for every one of them).
 *
 * Only plain relative references are touched. Anything with a scheme
 * (`https:`, `mailto:`, `data:`), a protocol-relative `//host`, or a bare
 * `#anchor` is the page's own business.
 */

import { isWikiMarkdownPath, resolveWikiReference, wikiEntryLookup, wikiHeadingSlug } from '@/shared/lib/wiki/pages';
import type { WikiEntry } from '@/shared/types/wiki';

export interface WikiRenderScope {
  /** Path of the page being rendered, inside the wiki tree. */
  path: string;
  /** Every path in the wiki, for reference resolution. */
  entries: readonly WikiEntry[];
  /** Workspace scope, so an asset URL names the same wiki the page came from. */
  root?: string;
  repo?: string;
}

/** URL of one file's bytes through `/api/wiki/asset`, carrying the same scope. */
export function buildWikiAssetUrl(assetPath: string, scope: { root?: string; repo?: string } = {}): string {
  const params = new URLSearchParams({ path: assetPath });
  if (scope.root) params.set('root', scope.root);
  if (scope.repo && scope.repo !== '.') params.set('repo', scope.repo);
  return `/api/wiki/asset?${params.toString()}`;
}

/** Attribute values are injected as HTML, so `&` and `"` must be entities. */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** The heading's own text, with inline markup and entities flattened. */
function headingText(inner: string): string {
  return inner
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

const HEADING_RE = /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g;
const ID_ATTR_RE = /\sid="[^"]*"/;

/**
 * Give every heading the id the page's own `#anchor` links name.
 *
 * See {@link wikiHeadingSlug} for why the renderer's own id is not usable: the
 * emoji in `## 🎯 Overview` survives into it, while the TOC the author wrote
 * says `#overview`.
 */
function rewriteHeadingIds(html: string): string {
  return html.replace(HEADING_RE, (match, level: string, attrs: string, inner: string) => {
    const slug = wikiHeadingSlug(headingText(inner));
    if (!slug) return match;
    const id = ` id="${escapeAttribute(slug)}"`;
    return `<h${level}${ID_ATTR_RE.test(attrs) ? attrs.replace(ID_ATTR_RE, id) : `${attrs}${id}`}>${inner}</h${level}>`;
  });
}

/**
 * Rewrite the relative `src`/`href` attributes of rendered wiki HTML, and give
 * its headings the ids its own anchors point at.
 *
 * Fenced code is already escaped by the renderer, so a literal `src="` inside a
 * code block cannot be mistaken for an attribute, and a `#` comment inside a
 * fence is inside `<pre>`, never a heading.
 */
export function rewriteWikiReferences(html: string, scope: WikiRenderScope): string {
  const lookup = wikiEntryLookup(scope.entries);
  const rewritten = html.replace(/(\s(?:src|href))="([^"]*)"/g, (match, attribute: string, value: string) => {
    const resolved = resolveWikiReference(value, scope.path, lookup);
    if (!resolved) return match;
    const isLink = attribute.trim() === 'href';
    const url = ` ${isLink ? 'href' : 'src'}="${escapeAttribute(buildWikiAssetUrl(resolved, scope))}"`;
    // Only a page gets the navigation marker: a link to any other file in the
    // wiki keeps its asset URL (copyable, middle-clickable) and stays inert on
    // a plain click, because the panel is a reader, not a file browser.
    return isLink && isWikiMarkdownPath(resolved)
      ? `${url} data-wiki-path="${escapeAttribute(resolved)}"`
      : url;
  });
  return rewriteHeadingIds(rewritten);
}
