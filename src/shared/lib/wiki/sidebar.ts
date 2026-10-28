/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A wiki's OWN navigation, read from its `_Sidebar.md`.
 *
 * Both hosts serve that file as the navigation around every page, so it is the
 * author's own nav — grouping, order and labels included — and the panel renders
 * it rather than re-deriving a tree from the file layout. Verified: the GitLab
 * wikis here carry `_sidebar.md` with `### 📚 Navigation` / `### 📋 Changelogs`
 * groups, while `github.com/jgraph/drawio` has none at all and falls back to
 * `sectionsFromEntries`.
 *
 * Deliberately tolerant, because a sidebar is hand-written: a link with a title,
 * a rule instead of a heading, a nested bullet and a trailing prose block all
 * appear in real files (the version block under `### 📊 Info` in this repo's own
 * wiki is one).
 */

import { resolveWikiReference, wikiEntryLookup } from '@/shared/lib/wiki/pages';
import type { WikiEntry, WikiNavLink, WikiNavSection } from '@/shared/types/wiki';

/** Extension stripped from a path's basename. */
const MARKDOWN_EXT_RE = /\.(md|markdown)$/i;

/**
 * The navigation file both hosts render around every page. It is NOT a page —
 * it is the nav the panel draws — so it is excluded from the page list and read
 * as navigation instead (see {@link parseWikiSidebar}).
 */
const WIKI_SIDEBAR_BASENAME = '_sidebar';

/**
 * The wiki's own `_Sidebar.md`, or null when it has none.
 *
 * Both hosts serve this file as the navigation around every page, so it is the
 * author's own nav — grouping, order and labels included — and the panel renders
 * it instead of re-deriving a tree from the file layout. Verified: the GitLab
 * wikis here carry `_sidebar.md` with `### 📚 Navigation` / `### 📋 Changelogs`
 * groups, while `github.com/jgraph/drawio` has none at all.
 */
export function findWikiSidebarPath(paths: readonly string[]): string | null {
  const candidates = paths.filter((path) => {
    const base = (path.split('/').pop() ?? '').replace(MARKDOWN_EXT_RE, '').toLowerCase();
    return base === WIKI_SIDEBAR_BASENAME;
  });
  if (candidates.length === 0) return null;
  // A root sidebar wins: that is where both hosts look for it, and a nested
  // one is a page's own leftover rather than the wiki's navigation.
  return candidates.find((path) => !path.includes('/')) ?? candidates[0];
}

/** A heading (`### 📋 Changelogs`) — the section boundary of a sidebar. */
const SIDEBAR_HEADING_RE = /^\s{0,3}#{1,6}\s+(.*?)\s*$/;
/** A list item holding a markdown link, with any `"title"` after the target. */
const SIDEBAR_ITEM_RE = /^\s*[-*+]\s+\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/;
/** A horizontal rule — `---`, the separator between sidebar groups. */
const SIDEBAR_RULE_RE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;

/** Markdown emphasis and code ticks removed, for a label the panel prints as text. */
function plainText(value: string): string {
  return value.replace(/\*\*|__|[*`]/g, '').trim();
}

/**
 * Parse a wiki's `_Sidebar.md` into the sections the panel renders.
 *
 * Deliberately tolerant: a sidebar is hand-written, so a link with a title, a
 * rule instead of a heading, a nested bullet and a trailing prose block all
 * appear in real files (the version block under `### 📊 Info` in this repo's own
 * wiki is one). A target that resolves into the wiki becomes a navigable page; a
 * target that does not is kept with `path: null` so the panel can show it as
 * inert text rather than pretending it leads somewhere.
 */
export function parseWikiSidebar(
  markdown: string,
  sidebarPath: string,
  entries: readonly WikiEntry[],
): WikiNavSection[] {
  const lookup = wikiEntryLookup(entries);
  const sections: WikiNavSection[] = [];
  let current: WikiNavSection | null = null;

  const section = (): WikiNavSection => {
    if (!current) {
      current = { title: null, links: [], notes: [] };
      sections.push(current);
    }
    return current;
  };

  for (const line of markdown.split('\n')) {
    const heading = line.match(SIDEBAR_HEADING_RE);
    if (heading) {
      current = { title: plainText(heading[1]) || null, links: [], notes: [] };
      sections.push(current);
      continue;
    }
    if (SIDEBAR_RULE_RE.test(line)) continue;

    const item = line.match(SIDEBAR_ITEM_RE);
    if (item) {
      const label = plainText(item[1]) || item[2];
      const target = item[2].trim();
      const resolved = resolveWikiReference(target, sidebarPath, lookup);
      section().links.push({
        label,
        target,
        path: resolved,
        // An absolute target is the author's own URL; it leaves the console.
        url: /^https?:/i.test(target) ? target : null,
      });
      continue;
    }

    const text = plainText(line);
    if (text) section().notes.push(text);
  }

  // A section that holds neither a link nor a note is a stray heading.
  return sections.filter((entry) => entry.links.length > 0 || entry.notes.length > 0);
}

/**
 * The fallback navigation, for a wiki with no `_Sidebar.md`: markdown pages
 * grouped by folder, in the order {@link buildWikiEntries} sorted them.
 */
export function sectionsFromEntries(entries: readonly WikiEntry[]): WikiNavSection[] {
  const sections: WikiNavSection[] = [];
  for (const entry of entries) {
    if (!entry.isMarkdown) continue;
    const last = sections[sections.length - 1];
    const link: WikiNavLink = { label: entry.title, target: entry.path, path: entry.path, url: null };
    if (last && last.title === (entry.folder || 'Pages')) {
      last.links.push(link);
      continue;
    }
    sections.push({ title: entry.folder || 'Pages', links: [link], notes: [] });
  }
  return sections;
}

/**
 * The sidebar plus every page it does not mention.
 *
 * A sidebar is the author's navigation, not an index — GitLab's own nav still
 * lists the pages a sidebar omits, and the panel has no address bar to reach one
 * otherwise. So the author's grouping and labels come first, and any page left
 * out is appended rather than hidden.
 */
export function withRemainingPages(sections: WikiNavSection[], entries: readonly WikiEntry[]): WikiNavSection[] {
  const listed = new Set<string>();
  for (const section of sections) {
    for (const link of section.links) {
      if (link.path) listed.add(link.path.toLowerCase());
    }
  }
  const missing = entries.filter((entry) => entry.isMarkdown && !listed.has(entry.path.toLowerCase()));
  if (missing.length === 0) return sections;
  return [
    ...sections,
    {
      title: 'Other pages',
      notes: [],
      links: missing.map((entry) => ({ label: entry.title, target: entry.path, path: entry.path, url: null })),
    },
  ];
}
