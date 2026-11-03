/**
 * @license
 * SPDX-License-Identifier: MIT
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
 * ONE more mode: a `review` bridge switches the parse to the MAPPED render, so
 * every top-level block carries `data-md-block` and a click names the block it
 * landed on instead of following its link. The handler consults that bridge
 * FIRST — a second click listener on the same container would have to agree with
 * this one about precedence, and the two would eventually disagree.
 *
 * Three source kinds, one pipeline: agent output (default), a workspace file's
 * preview (`document`), and a wiki page (`wikiScope`). The last two differ only
 * in what they let through — a document's own HTML is markup, and a wiki page
 * additionally gets gollum's `[[Page]]` links expanded and its references
 * resolved into the wiki's own tree.
 */

import type { TargetedMouseEvent } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { renderMarkdown, renderMappedMarkdown } from '@/shared/lib/markdown/marked';
import type { BlockVerdict, MdBlock } from '@/shared/lib/markdown/blocks/types';
import { rewriteDocumentReferences, type DocumentScope } from '@/shared/lib/markdown/document-urls';
import { rewriteWikiReferences, type WikiRenderScope } from '@/shared/lib/wiki/document-urls';
import { expandGollumLinks } from '@/shared/lib/wiki/pages';
import { MATH_PENDING_CLASS, preloadKatex } from '@/shared/lib/markdown/katex';
import { sanitizeHtml } from '@/shared/lib/markdown/sanitize';
import { DIRECTIVE_BLOCK_CLASS } from '@/shared/lib/markdown/directives';
import { hydrateDirectiveBlocks, unmountDirectiveBlocks } from '@/client/lib/plugins/directives';
import { useMathHydration, useMermaidHydration } from '@/client/hooks/ui/markdown-hydration';
import { useDirectiveContext, useDirectiveRenderer } from '@/client/hooks/workspace/directives';
import { copyToClipboard } from '@/client/hooks/ui/clipboard';
import { openFileInEditor } from '@/client/hooks/ui/open-file';
import { useSyntaxReady } from '@/client/hooks/ui/syntax-ready';
import { DiagramViewer } from '@/client/components/common/diagram-viewer';
import { readDiagramBlock, type DiagramSnapshot } from '@/client/components/common/diagram-viewer/read-block';


/** `useLayoutEffect` warns under SSR; the document renderer runs in both. */
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
  /**
   * The review layer, when it is ON.
   *
   * Absent is the ordinary renderer: no `data-md-*` attributes are emitted and
   * every click keeps its usual meaning. Present switches the pipeline to the
   * MAPPED render (each block carries its identity) and routes block clicks to
   * `onPick` BEFORE the copy/link/diagram branches — one handler, one
   * precedence rule, because two handlers on one container would have to agree
   * about which wins.
   */
  review?: MarkdownReviewBridge;
  /** The blocks the render produced, for a caller that stores judgements. */
  onBlocks?: (blocks: MdBlock[]) => void;
}

/** What the renderer needs of the review surface — nothing about storage. */
export interface MarkdownReviewBridge {
  active: boolean;
  /** Verdicts by block key, painted as `data-md-verdict`. */
  marks: ReadonlyMap<string, BlockVerdict>;
  /** The block the popover is open on, painted as `data-md-selected`. */
  selected: string | null;
  /** A block was clicked while review was active; `rect` is where it was. */
  onPick: (block: MdBlock, rect: DOMRect) => void;
}

export function MarkdownRenderer({
  content,
  className = '',
  document: isDocument = false,
  scope,
  wikiScope,
  onWikiNavigate,
  review,
  onBlocks,
}: MarkdownRendererProps) {
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

  /**
   * Review mode is a MODE, not a flag on the parse: it changes which pipeline
   * entry point runs, because only the mapped one emits `data-md-block`. Kept
   * to a boolean so a caller passing a fresh bridge object per render does not
   * re-parse the whole document.
   */
  const reviewActive = review?.active === true;

  const rendered = useMemo(() => {
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
    // If the message contains math, start fetching KaTeX during parse rather
    // than waiting for the post-mount hydration effect — the request overlaps
    // sanitization and the rest of the render instead of following it.
    if (scoped.includes(MATH_PENDING_CLASS)) preloadKatex();
    return { html: sanitizeHtml(scoped), blocks: mapped?.blocks ?? [] };
    // Primitives, never the `wikiScope` object: the panel memoizes it, but a
    // call site that builds one inline must not re-parse the page per render.
  }, [content, syntaxReady, isDocument, scopePath, scopeRoot, scopeRepo, isWiki, wikiPath, wikiEntries, wikiRoot, wikiRepo, reviewActive]);

  const { html, blocks } = rendered;

  // The caller stores judgements against these, so it has to know what the
  // render actually produced — never what the file contains (a healed or
  // truncated document renders fewer blocks than it has lines).
  useEffect(() => {
    if (onBlocks) onBlocks(blocks);
  }, [blocks, onBlocks]);

  const byKey = useMemo(() => new Map(blocks.map((block) => [block.key, block])), [blocks]);

  /**
   * Paint the verdicts onto the rendered DOM.
   *
   * An imperative pass rather than markup: the annotations arrive from the
   * server AFTER the HTML string was built (and the string is memoized on
   * content), so there is nothing to interpolate. The attributes are what the
   * CSS hangs off, and what the click handler reads.
   */
  const marks = review?.marks;
  const selected = review?.selected ?? null;
  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !reviewActive) return;
    for (const element of container.querySelectorAll<HTMLElement>('[data-md-block]')) {
      const key = element.dataset.mdBlock;
      if (!key) continue;
      const verdict = marks?.get(key);
      if (verdict) element.dataset.mdVerdict = verdict;
      else delete element.dataset.mdVerdict;
      if (key === selected) element.dataset.mdSelected = 'true';
      else delete element.dataset.mdSelected;
    }
  }, [html, marks, selected, reviewActive]);

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
  // placeholders emitted by `marked.ts` are swapped for real markup by the hook.
  useMathHydration(containerRef, html, hasMath);

  // Diagrams bake the palette into their SVG, so a theme write re-renders them —
  // through the block the open viewer was read from, which the hook hands back
  // when that block survived the re-render.
  const onDiagramBlock = useCallback((block: HTMLElement) => {
    const snapshot = readDiagramBlock(block);
    if (snapshot) setDiagram(snapshot);
  }, []);
  useMermaidHydration({
    container: containerRef,
    html,
    active: hasMermaid,
    diagramBlock: diagramBlockRef,
    onDiagramBlock,
  });

  // Read through a ref so the single delegated handler never has to be rebuilt
  // for a new bridge object — and so it always sees the CURRENT mode.
  const reviewRef = useRef(review);
  reviewRef.current = review;
  const byKeyRef = useRef(byKey);
  byKeyRef.current = byKey;

  const handleContainerClick = useCallback((e: TargetedMouseEvent<HTMLDivElement>) => {
    const bridge = reviewRef.current;
    if (bridge?.active) {
      // In review mode a click names a BLOCK. Consumed before the copy button,
      // the diagram and the document links, because otherwise the reader could
      // not select a block that happens to contain one of them.
      const block = (e.target as HTMLElement).closest<HTMLElement>('[data-md-block]');
      const key = block?.dataset.mdBlock;
      const picked = key ? byKeyRef.current.get(key) : undefined;
      if (picked) {
        e.preventDefault();
        e.stopPropagation();
        bridge.onPick(picked, block!.getBoundingClientRect());
      }
      return;
    }

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
