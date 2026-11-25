/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The HTML one markdown source renders to, and the blocks a review pass can
 * address in it.
 *
 * Extracted from `MarkdownRenderer` for the per-file ceiling, and because the
 * source kinds are a reading rule rather than a component concern: agent output
 * escapes its own HTML, a document preview trusts it, a wiki page additionally
 * expands gollum links and resolves references into the wiki's tree. The three
 * share the remend → marked → sanitize pipeline, so they share this hook.
 *
 * Two marks are applied to chat output only: a local picture's `file://`
 * spelling is normalized BEFORE sanitization (DOMPurify drops that scheme), and
 * the path is moved to `data-local-image` AFTER it. The browser then never
 * requests `/Users/…` from the app origin; the post-mount hydration pass turns
 * the marker into the session image route.
 */

import { useMemo } from 'preact/hooks';
import { renderMarkdown, renderMappedMarkdown } from '@/shared/lib/markdown/marked';
import type { MdBlock } from '@/shared/lib/markdown/blocks/types';
import { rewriteDocumentReferences } from '@/shared/lib/markdown/document-urls';
import type { WikiRenderScope } from '@/shared/lib/wiki/document-urls';
import { rewriteWikiReferences } from '@/shared/lib/wiki/document-urls';
import { expandGollumLinks } from '@/shared/lib/wiki/pages';
import { MATH_PENDING_CLASS, preloadKatex } from '@/shared/lib/markdown/katex';
import { sanitizeHtml } from '@/shared/lib/markdown/sanitize';
import { markInlineFilePaths } from '@/shared/lib/markdown/inline-file';
import { localizeFileImageSources, markLocalImageSources } from '@/shared/lib/chat/timeline/local-image';

export interface RenderedMarkdown {
  html: string;
  blocks: MdBlock[];
}

/** Everything the render depends on, as PRIMITIVES. A new object per render is
 *  fine because the memo keys on the fields, not on the object. */
export interface MarkdownRenderOptions {
  content: string;
  syntaxReady: boolean;
  isDocument: boolean;
  scopePath: string | undefined;
  scopeRoot: string | undefined;
  scopeRepo: string | undefined;
  isWiki: boolean;
  wikiPath: string | undefined;
  wikiEntries: WikiRenderScope['entries'] | undefined;
  wikiRoot: string | undefined;
  wikiRepo: string | undefined;
  reviewActive: boolean;
  sessionId: string | undefined;
}

export function useRenderedMarkdown(options: MarkdownRenderOptions): RenderedMarkdown {
  const {
    content,
    syntaxReady,
    isDocument,
    scopePath,
    scopeRoot,
    scopeRepo,
    isWiki,
    wikiPath,
    wikiEntries,
    wikiRoot,
    wikiRepo,
    reviewActive,
    sessionId,
  } = options;

  return useMemo(() => {
    if (!content) return { html: '', blocks: [] as MdBlock[] };
    // Gollum's `[[Page]]` is invisible to a markdown parser, so it is expanded
    // before parsing rather than patched afterwards.
    const source = wikiPath ? expandGollumLinks(content) : content;
    const allowHtml = isDocument || isWiki;
    const mapped = reviewActive ? renderMappedMarkdown(source, { allowHtml }) : null;
    const markdown = mapped ? mapped.html : renderMarkdown(source, { allowHtml });
    const scoped = wikiPath && wikiEntries
      ? rewriteWikiReferences(markdown, { path: wikiPath, entries: wikiEntries, root: wikiRoot, repo: wikiRepo })
      : isDocument && scopePath
        ? rewriteDocumentReferences(markdown, { path: scopePath, root: scopeRoot, repo: scopeRepo })
        : markdown;
    // A document or wiki already rewrote its references to a scope above, so
    // only agent output gets the chat image treatment.
    const chat = Boolean(sessionId) && !isDocument && !isWiki;
    const localized = chat ? localizeFileImageSources(scoped) : scoped;
    // If the message contains math, start fetching KaTeX during parse rather
    // than waiting for the post-mount hydration effect — the request overlaps
    // sanitization and the rest of the render instead of following it.
    if (localized.includes(MATH_PENDING_CLASS)) preloadKatex();
    const sanitized = sanitizeHtml(localized);
    // Agent output is the one place an inline `` `path` `` is a file the reader
    // can open. A document preview and a wiki page resolve their OWN references
    // through the scope above, so marking them here would be a second rule for
    // the same job. The marker runs after sanitization: the attributes never
    // need a DOMPurify allow-list entry (same contract as local images).
    const agentOutput = !isDocument && !isWiki;
    const withFiles = agentOutput ? markInlineFilePaths(sanitized) : sanitized;
    return {
      html: chat ? markLocalImageSources(withFiles) : withFiles,
      blocks: mapped?.blocks ?? [],
    };
    // Primitive deps: the caller may build `scope`/`wikiScope` inline, and a
    // new object identity would re-parse the whole document every render.
    // `syntaxReady` is a dep even though it is not read: the highlighter's own
    // readiness changes what `renderMarkdown` renders.
  }, [
    content,
    syntaxReady,
    isDocument,
    scopePath,
    scopeRoot,
    scopeRepo,
    isWiki,
    wikiPath,
    wikiEntries,
    wikiRoot,
    wikiRepo,
    reviewActive,
    sessionId,
  ]);
}
