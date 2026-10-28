/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Wiki tree → page list, and wiki reference → page path.
 *
 * Shared by the server (which builds the list out of `git ls-tree`) and the
 * panel (which resolves a page's own links and images against that list), so
 * the two can never disagree about what a wiki contains or what
 * `[x](change_logs/v1.6.0)` points at.
 *
 * Three provider conventions are encoded here because each is load-bearing for
 * a reader and none is visible in the raw markdown:
 *
 *   - **Chrome files are not pages.** GitHub and GitLab both treat
 *     `_Sidebar`/`_Footer`/`_Header` as fragments the host renders around every
 *     page. Listing them as pages puts a nav fragment in the middle of the nav.
 *   - **References are case- and space-insensitive.** GitHub's own wiki
 *     resolves `/wiki/eMbEd-Diagrams` as readily as `/wiki/Embed-Diagrams`
 *     (verified), and its `[[Embed Diagrams]]` link targets `Embed-Diagrams.md`
 *     — gollum turns spaces into dashes. GitLab's `[v1.6.0](change_logs/v1.6.0)`
 *     omits the `.md` entirely. Resolution therefore tries the written path, the
 *     path with the extension, the dash form of both, and matches them
 *     case-insensitively.
 *   - **Assets are entries too.** A page's `![](images/schema.png)` resolves
 *     against the same tree the pages do, so the listing keeps them and only
 *     the reader filters on `isMarkdown`.
 */

import type { WikiEntry } from '@/shared/types/wiki';

/** Wiki chrome: navigation/footer/header fragments, not pages. */
const WIKI_CHROME: Record<string, true> = {
  _sidebar: true,
  _footer: true,
  _header: true,
};

/** Extension stripped from a path's basename. */
const MARKDOWN_EXT_RE = /\.(md|markdown)$/i;

export function isWikiMarkdownPath(path: string): boolean {
  return MARKDOWN_EXT_RE.test(path);
}

/**
 * The wiki tree as a list: markdown pages first (Home, then root pages, then
 * folder groups, alphabetical within each), assets after them.
 */
export function buildWikiEntries(paths: readonly string[]): WikiEntry[] {
  const entries: WikiEntry[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (!path || seen.has(path)) continue;
    const segments = path.split('/');
    // GitLab keeps its redirect map in `.gitlab/redirects.yml`; a dot-segment
    // is provider metadata on either host, never a page.
    if (segments.some((segment) => segment.startsWith('.'))) continue;
    const base = segments[segments.length - 1] ?? path;
    if (WIKI_CHROME[base.replace(MARKDOWN_EXT_RE, '').toLowerCase()]) continue;
    seen.add(path);
    const slash = path.lastIndexOf('/');
    entries.push({
      path,
      title: base.replace(MARKDOWN_EXT_RE, ''),
      folder: slash < 0 ? '' : path.slice(0, slash),
      isMarkdown: MARKDOWN_EXT_RE.test(path),
    });
  }

  return entries.sort((a, b) => {
    if (a.isMarkdown !== b.isMarkdown) return a.isMarkdown ? -1 : 1;
    if (!a.isMarkdown) return a.path.localeCompare(b.path);
    const aHome = a.title.toLowerCase() === 'home';
    const bHome = b.title.toLowerCase() === 'home';
    if (aHome !== bHome) return aHome ? -1 : 1;
    if (a.folder !== b.folder) {
      if (!a.folder) return -1;
      if (!b.folder) return 1;
      return a.folder.localeCompare(b.folder);
    }
    return a.title.localeCompare(b.title);
  });
}

/** Lower-cased path → the path as stored, for case-insensitive resolution. */
export function wikiEntryLookup(entries: readonly WikiEntry[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const entry of entries) {
    const key = entry.path.toLowerCase();
    if (!lookup.has(key)) lookup.set(key, entry.path);
  }
  return lookup;
}

/** Collapse `.`/`..` segments; climbing above the wiki root is dropped. */
export function normalizeWikiSegments(segments: readonly string[]): string {
  const out: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join('/');
}

/** A scheme (`https:`), protocol-relative host, in-page fragment, or empty. */
const NON_WIKI_REFERENCE_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|$)/i;

/** Whether a reference is an explicit relative path (`./x`, `../x`). */
const EXPLICIT_RELATIVE_RE = /^\.{1,2}[/\\]/;

/**
 * The wiki path a reference written inside `fromPath` names, or null when the
 * reference is not an in-wiki one (leave those exactly as written).
 *
 * **A bare path is resolved from the wiki ROOT first, then from the page's own
 * folder.** That order is not a coin flip: it is what both hosts do, and it is
 * the difference between a working link and an inert one on a nested wiki. A
 * real GitLab wiki writes `[TRD v1.3.3](trd/v1.3.3/home)` from
 * `trd/v1.3.2/home.md` — from the root, while page-relative resolution looks
 * for `trd/v1.3.2/trd/v1.3.3/home` and finds nothing (measured: 25 of the 41
 * links on that wiki failed to resolve, and every one of them then opened a
 * browser tab instead of a page). An explicitly relative reference (`./x`,
 * `../x`) is the author asking for the page's own folder, so it is tried there
 * first; `../trd/v1.3.3/home` from `change_logs/v1.3.3.md` is the same target
 * written the other way.
 *
 * `lookup` is the wiki's own path map, so a hit is proof the target exists —
 * which is what lets the caller turn a link into in-panel navigation.
 */
export function resolveWikiReference(
  reference: string,
  fromPath: string,
  lookup: Map<string, string>,
): string | null {
  const raw = reference.trim();
  if (NON_WIKI_REFERENCE_RE.test(raw)) return null;

  // `?v=1` and `#section` address the page, not the file in the tree. A leading
  // `/` is the wiki's own root, which is the same thing as a bare path here.
  const withoutQuery = raw.replace(/^[/\\]+/, '').split(/[?#]/)[0];
  let decoded = withoutQuery;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    // A malformed escape is the reference's own problem; use it verbatim.
  }
  if (!decoded) return null;

  const segments = decoded.split(/[\\/]+/);
  const pageDir = fromPath.split('/').slice(0, -1);
  const bases = EXPLICIT_RELATIVE_RE.test(decoded) ? [pageDir, []] : [[], pageDir];
  for (const base of bases) {
    const path = normalizeWikiSegments([...base, ...segments]);
    if (!path) continue;
    // The written path, the extension both providers omit, and gollum's
    // space→dash form of each.
    const dashed = path.replace(/ /g, '-');
    for (const candidate of [path, `${path}.md`, dashed, `${dashed}.md`]) {
      const hit = lookup.get(candidate.toLowerCase());
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * The id a wiki heading gets, which is what the page's own `#anchor` links name.
 *
 * Both hosts slug a heading by lowercasing it and dropping everything that is
 * not a letter, a digit, a combining mark, a space, a hyphen or an underscore,
 * then turning spaces into hyphens. The mark matters: `## ⚠️ Migration Queries`
 * is `#%EF%B8%8F-migration-queries` — the warning sign (a symbol) is dropped
 * while the variation selector after it (a mark, U+FE0F) survives. Verified
 * against `git-rbi.jatismobile.com/jns6_5/drrealhandler`, whose changelog pages
 * link exactly that anchor.
 *
 * That is not cosmetic: a wiki's table of contents is written as
 * `[Overview](#overview)`, and with the renderer's own id (which keeps the
 * emoji) every entry pointed at an element that did not exist, so clicking a
 * TOC link did nothing at all.
 */
export function wikiHeadingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * One `[[Label|Target]]` link, converted to the markdown link both hosts render.
 *
 * The destination is percent-encoded because a gollum page name holds spaces
 * (`[[Embed Diagrams]]`) and a markdown destination cannot: `[x](Embed Diagrams)`
 * is not a link at all, so marked emits the brackets as literal text. Encoding
 * the space keeps the target resolvable by {@link resolveWikiReference}, which
 * decodes it before matching.
 */
function expandGollumLink(inner: string): string {
  const parts = inner.split('|').map((part) => part.trim());
  if (parts.length === 1) {
    const target = encodeURI(parts[0]);
    return `[${parts[0]}](${target})`;
  }
  const anchor = parts[2] ? `#${encodeURI(parts[2])}` : '';
  return `[${parts[0]}](${encodeURI(parts[1])}${anchor})`;
}

/**
 * Expand gollum's `[[Page]]` / `[[Label|Page]]` wiki links into markdown links.
 *
 * GitHub wikis are gollum, and a `[[Page]]` is invisible to a markdown parser —
 * it would render as literal brackets. Fenced blocks and inline code are left
 * alone, so a page that documents the syntax does not get its example rewritten.
 */
export function expandGollumLinks(markdown: string): string {
  let fenced = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(?:```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      // Odd segments are inline code: `[[x]]` inside backticks is an example.
      return line
        .split('`')
        .map((part, index) =>
          index % 2 === 1 ? part : part.replace(/\[\[([^[\]]+)\]\]/g, (_, inner: string) => expandGollumLink(inner)),
        )
        .join('`');
    })
    .join('\n');
}
