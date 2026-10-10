/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Markdown renderer for the chat timeline, editor previews and the wiki reader.
 *
 * Pipeline: remend (heal streaming) → marked (GFM, autolink, KaTeX) →
 * DOMPurify (sanitize). Renders as sanitized HTML. Raw HTML in the source is
 * escaped by DOMPurify (default profile) rather than executed. A single
 * delegated click handler manages the per-block "Copy" buttons. Mermaid
 * fences hydrate async into sanitized SVGs after mount.
 *
 * Three source kinds, one pipeline: agent output (default), a workspace file's
 * preview (`document`), and a wiki page (`wikiScope`). The last two differ only
 * in what they let through — a document's own HTML is markup, and a wiki page
 * additionally gets gollum's `[[Page]]` links expanded and its references
 * resolved into the wiki's own tree.
 */

import type { TargetedMouseEvent } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { renderMarkdown } from '@/shared/lib/markdown/marked';
import { rewriteDocumentReferences, type DocumentScope } from '@/shared/lib/markdown/document-urls';
import { rewriteWikiReferences, type WikiRenderScope } from '@/shared/lib/wiki/document-urls';
import { expandGollumLinks } from '@/shared/lib/wiki/pages';
import { hydrateMathBlocks, MATH_PENDING_CLASS, preloadKatex } from '@/shared/lib/markdown/katex';
import { sanitizeHtml } from '@/shared/lib/markdown/sanitize';
import { hydrateMermaidBlocks } from '@/shared/lib/markdown/mermaid';
import { DIRECTIVE_BLOCK_CLASS } from '@/shared/lib/markdown/directives';
import { hydrateDirectiveBlocks, unmountDirectiveBlocks } from '@/client/lib/plugins/directives';
import { useDirectiveContext, useDirectiveRenderer } from '@/client/hooks/workspace/directives';
import { copyToClipboard } from '@/client/hooks/ui/clipboard';
import { openFileInEditor } from '@/client/hooks/ui/open-file';
import { useSyntaxReady } from '@/client/hooks/ui/syntax-ready';
import { DiagramViewer } from '@/client/components/common/diagram-viewer';
import { readDiagramBlock, type DiagramSnapshot } from '@/client/components/common/diagram-viewer/read-block';


const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface MarkdownRendererProps {
  content: string;
  className?: string;
  /**
   * Render the content as the document it IS (an opened file's preview) rather
   * than as agent output: the source's own HTML renders as markup instead of
   * showing its tags, and relative references resolve against `scope`.
   */
  document?: boolean;
  /** Where the document lives, so its relative links and images resolve. */
  scope?: DocumentScope;
  /**
   * Render the content as a wiki page: its own HTML is markup, its `[[Page]]`
   * links expand, and its references resolve against the wiki's tree. Keep the
   * object identity stable (memoize it) — a new one re-parses the page.
   */
  wikiScope?: WikiRenderScope;
  /** Follow a wiki link to another page of the same wiki. */
  onWikiNavigate?: (path: string) => void;
}

export function MarkdownRenderer({ content, className = '', document: isDocument = false, scope, wikiScope, onWikiNavigate }: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  /** Block the open viewer was read from, so a theme re-render can refresh it. */
  const diagramBlockRef = useRef<HTMLElement | null>(null);
  const [diagram, setDiagram] = useState<DiagramSnapshot | null>(null);

  const syntaxReady = useSyntaxReady();

  // Primitive deps: call sites build `scope` inline, and a new object identity
  // per render would re-run marked + DOMPurify over the whole document.
  const scopePath = scope?.path;
  const scopeRoot = scope?.root;
  const scopeRepo = scope?.repo;
  const wikiPath = wikiScope?.path;
  const wikiEntries = wikiScope?.entries;
  const wikiRoot = wikiScope?.root;
  const wikiRepo = wikiScope?.repo;
  /** Presence, not identity: this drives the click handler, never the parse. */
  const isWiki = wikiScope !== undefined;

  const html = useMemo(() => {
    if (!content) return '';
    // Gollum's `[[Page]]` is invisible to a markdown parser, so it is expanded
    // before parsing rather than patched afterwards.
    const source = wikiPath ? expandGollumLinks(content) : content;
    const rendered = renderMarkdown(source, { allowHtml: isDocument || isWiki });
    const scoped = wikiPath && wikiEntries
      ? rewriteWikiReferences(rendered, { path: wikiPath, entries: wikiEntries, root: wikiRoot, repo: wikiRepo })
      : isDocument && scopePath
        ? rewriteDocumentReferences(rendered, { path: scopePath, root: scopeRoot, repo: scopeRepo })
        : rendered;
    // If the message contains math, start fetching KaTeX during parse rather
    // than waiting for the post-mount hydration effect — the request overlaps
    // sanitization and the rest of the render instead of following it.
    if (scoped.includes(MATH_PENDING_CLASS)) preloadKatex();
    return sanitizeHtml(scoped);
    // Primitives, never the `wikiScope` object: the panel memoizes it, but a
    // call site that builds one inline must not re-parse the page per render.
  }, [content, syntaxReady, isDocument, scopePath, scopeRoot, scopeRepo, isWiki, wikiPath, wikiEntries, wikiRoot, wikiRepo]);

  const hasMermaid = html.includes('mermaid-block');
  const hasMath = html.includes(MATH_PENDING_CLASS);
  const hasDirective = html.includes(DIRECTIVE_BLOCK_CLASS);

  // A claimed fence renders the plugin's component. The placeholder holds the
  // ordinary code block, so an unclaimed one needs no work at all.
  const directive = useDirectiveRenderer();
  const slotContext = useDirectiveContext();
  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current;
    if (!hasDirective || !container || typeof window === 'undefined') return;
    hydrateDirectiveBlocks(container, directive, slotContext);
    // `html` is a dep so a re-parse re-hydrates; the call itself is idempotent,
    // so a re-render with the same markup does nothing.
    //
    // The cleanup is not optional: `render()` mounts a real Preact tree, and a
    // timeline that drops a message (a rewind, a session switch) would leave
    // that tree's hooks and effects alive against a detached host. The markup
    // itself is the container's own, so the next render re-creates it — only
    // the plugin tree has to be taken down here.
    return () => unmountDirectiveBlocks(container);
  }, [hasDirective, html, directive, slotContext]);

  // KaTeX is ~522 kB of JS fetched only when a message contains math; the
  // placeholders emitted by `marked.ts` are swapped for real markup here.
  useEffect(() => {
    if (!hasMath || typeof window === 'undefined') return;
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const hydrate = async () => {
      if (!container.isConnected) return;
      await hydrateMathBlocks(container);
      if (cancelled) return;
    };
    void hydrate();
    // Same reason as the mermaid observer: a timeline re-render can replace the
    // container's innerHTML with an identical string without this effect
    // re-running, stranding new placeholders. hydrate() only writes inside the
    // placeholder elements, so it never re-triggers this observer.
    const observer = new MutationObserver(() => {
      const current = containerRef.current;
      if (current?.isConnected) void hydrateMathBlocks(current);
    });
    observer.observe(container, { childList: true });

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [hasMath, html]);

  useIsomorphicLayoutEffect(() => {
    if (!hasMermaid || typeof window === 'undefined') return;
    const container = containerRef.current;
    if (!container) return;

    let timer: number | undefined;
    const hydrate = async () => {
      const current = containerRef.current;
      if (!current || !current.isConnected) return;
      await hydrateMermaidBlocks(current);
    };

    void hydrate();
    // React can rewrite the container's innerHTML with an identical html
    // string (timeline re-renders) without this effect re-running, which
    // would strand freshly-inserted pending blocks. Re-hydrate on any
    // direct-child replacement; hydrate writes only to grandchildren, so it
    // never re-triggers this observer.
    const observer = new MutationObserver(() => {
      const current = containerRef.current;
      if (current?.isConnected) void hydrateMermaidBlocks(current, { cachedOnly: true });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void hydrate(), 120);
    });
    observer.observe(container, { childList: true });

    // Diagrams bake the palette into their SVG, so every theme write must
    // re-render them. The trigger is the `data-theme` attribute itself rather
    // than the `omp:theme-changed` event: the navbar toggle and the settings
    // modal are both writers, and observing the attribute catches all of them
    // the moment the document changes. Vacuously cheap for a same-palette write
    // (blocks already matching the new theme key are skipped).
    const rehydrateForTheme = async () => {
      await hydrate();
      const block = diagramBlockRef.current;
      // A timeline re-render can replace the block under an open viewer; keep
      // the last snapshot then rather than closing the viewer on the user.
      if (!block?.isConnected) return;
      const snapshot = readDiagramBlock(block);
      if (snapshot) setDiagram(snapshot);
    };
    const themeObserver = new MutationObserver(() => void rehydrateForTheme());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      themeObserver.disconnect();
    };
  }, [hasMermaid, html]);

  const handleContainerClick = useCallback((e: TargetedMouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>('button.code-copy-float');
    if (target) {
      const text = target.dataset.copy ?? '';
      if (!text) return;
      e.preventDefault();
      e.stopPropagation();
      void copyToClipboard(text).then((ok) => {
        if (!ok) return;
        target.setAttribute('data-copied', 'true');
        target.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => {
          target.removeAttribute('data-copied');
          target.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        }, 2000);
      });
      return;
    }

    // A rendered diagram is a door into the zoom/pan viewer; pending, failed,
    // and still-streaming blocks stay inert. It is checked before the document
    // links below so a diagram's own anchors never steal its click.
    const block = (e.target as HTMLElement).closest<HTMLElement>('.mermaid-block[data-mermaid-state="done"]');
    if (block) {
      const snapshot = readDiagramBlock(block);
      if (!snapshot) return;
      e.preventDefault();
      diagramBlockRef.current = block;
      setDiagram(snapshot);
      return;
    }

    if (isWiki) {
      // A wiki page's own links. The RAW attribute is what classifies them, not
      // `link.href`: that property is always absolutised by the DOM, so a
      // relative path which named no page of this wiki read as external and
      // every such link opened a browser tab instead of doing nothing.
      const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
      if (!link) return;
      const raw = link.getAttribute('href') ?? '';
      // An in-page anchor is the browser's own business — the heading it names
      // carries the id the wiki's table of contents wrote. Letting the default
      // through is the whole point; preventing it made every TOC entry inert.
      if (raw.startsWith('#')) return;
      e.preventDefault();
      e.stopPropagation();
      const target = link.dataset.wikiPath;
      if (target && onWikiNavigate) {
        onWikiNavigate(target);
        return;
      }
      if (/^https?:/i.test(raw)) window.open(raw, '_blank', 'noopener,noreferrer');
      // A relative href that resolved to nothing in this wiki is inert.
      return;
    }

    if (!isDocument) return;

    // A document's own links: a relative one is rewritten to the workspace
    // file it names, so it belongs in an editor tab rather than in a top-level
    // navigation off the console; an external one leaves the console.
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    e.preventDefault();
    e.stopPropagation();
    const filePath = link.dataset.filePath;
    if (filePath) {
      openFileInEditor({ path: filePath, root: scopeRoot, repo: scopeRepo });
    } else if (/^https?:/i.test(link.href)) {
      window.open(link.href, '_blank', 'noopener,noreferrer');
    }
  }, [isDocument, scopeRoot, scopeRepo, isWiki, onWikiNavigate]);

  const closeDiagram = useCallback(() => {
    diagramBlockRef.current = null;
    setDiagram(null);
  }, []);

  if (!content) return null;

  return (
    <>
      <div
        ref={containerRef}
        className={`prose-content text-[13px] text-ink leading-relaxed select-text ${className}`}
        onClick={handleContainerClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {diagram && <DiagramViewer {...diagram} onClose={closeDiagram} />}
    </>
  );
}
