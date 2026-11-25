/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a link click means in the two SCOPED markdown surfaces — a wiki page
 * and a document preview.
 *
 * Extracted from `MarkdownRenderer` rather than grown in place: the component
 * sits at the repository's per-file ceiling, and this is one rule with two
 * shapes, not a renderer concern. The chat path never reaches it: an agent's
 * own links keep their usual meaning.
 *
 * A wiki page's links are classified from the RAW attribute, not `link.href`:
 * the property is always absolutised by the DOM, so a relative path that named
 * no page of this wiki read as external and every such link opened a browser
 * tab instead of doing nothing.
 */

import { openFileInEditor } from '@/client/hooks/ui/open-file';

/** The click, as both Preact's delegated event and a DOM event present it. */
interface ClickLike {
  preventDefault(): void;
  stopPropagation(): void;
}

export interface ScopedLinkOptions {
  isWiki: boolean;
  isDocument: boolean;
  scopeRoot?: string;
  scopeRepo?: string;
  onWikiNavigate?: (path: string) => void;
}

/**
 * Consume a click on a rendered anchor.
 *
 * `isWiki` handles wiki links and returns without following anything it cannot
 * resolve; a document's relative links were rewritten to `data-file-path` by
 * `rewriteDocumentReferences` and belong in an editor tab, while an external
 * one leaves the console.
 */
export function followScopedLink(
  event: ClickLike,
  link: HTMLAnchorElement,
  options: ScopedLinkOptions,
): void {
  if (options.isWiki) {
    const raw = link.getAttribute('href') ?? '';
    // An in-page anchor is the browser's own business — the heading it names
    // carries the id the wiki's table of contents wrote.
    if (raw.startsWith('#')) return;
    event.preventDefault();
    event.stopPropagation();
    const target = link.dataset.wikiPath;
    if (target && options.onWikiNavigate) {
      options.onWikiNavigate(target);
      return;
    }
    if (/^https?:/i.test(raw)) window.open(raw, '_blank', 'noopener,noreferrer');
    // A relative href that resolved to nothing in this wiki is inert.
    return;
  }

  if (!options.isDocument) return;

  event.preventDefault();
  event.stopPropagation();
  const filePath = link.dataset.filePath;
  if (filePath) {
    openFileInEditor({ path: filePath, root: options.scopeRoot, repo: options.scopeRepo });
  } else if (/^https?:/i.test(link.href)) {
    window.open(link.href, '_blank', 'noopener,noreferrer');
  }
}
