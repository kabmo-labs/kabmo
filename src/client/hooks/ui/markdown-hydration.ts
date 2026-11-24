/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two post-mount hydration passes a rendered markdown document needs.
 *
 * Extracted from `MarkdownRenderer` for the per-file ceiling, and they belong in
 * a hook because they are not rendering: both observe the container and swap
 * placeholders for real content after the HTML string landed.
 *
 * ## Why an observer, in both cases
 *
 * The container's `innerHTML` can be replaced with an IDENTICAL string — the
 * chat timeline re-renders a message, a preview re-renders after a save — and
 * the effect does not re-run for an unchanged dependency. New placeholders would
 * then sit unhydrated forever. Each hydrator writes only inside the placeholder
 * elements it found, so it never re-triggers its own observer.
 *
 * ## KaTeX is lazy, mermaid is not
 *
 * `marked.ts` emits a `math-pending` span and `katex.ts` swaps it once ~522 kB
 * of JS arrives; a message with no math must never pay for that fetch. Mermaid
 * bakes the palette into its SVG, so every theme write has to re-render it — the
 * trigger is the `data-theme` ATTRIBUTE rather than the `omp:theme-changed`
 * event, because the navbar toggle and the settings modal are both writers and
 * observing the attribute catches all of them.
 */

import type { RefObject } from 'preact';
import { useEffect, useLayoutEffect } from 'preact/hooks';

import { hydrateMathBlocks } from '@/shared/lib/markdown/katex';
import { hydrateMermaidBlocks } from '@/shared/lib/markdown/mermaid';
import { LOCAL_IMAGE_ATTR, sessionImageUrl } from '@/shared/lib/chat/timeline/local-image';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Replace `math-pending` placeholders for real KaTeX markup, when there are any. */
export function useMathHydration(container: RefObject<HTMLElement>, html: string, active: boolean): void {
  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    const element = container.current;
    if (!element) return;

    let cancelled = false;
    const hydrate = async () => {
      if (!element.isConnected) return;
      await hydrateMathBlocks(element);
      if (cancelled) return;
    };
    void hydrate();
    const observer = new MutationObserver(() => {
      if (element.isConnected) void hydrateMathBlocks(element);
    });
    observer.observe(element, { childList: true });

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [container, active, html]);
}

export interface MermaidHydrationOptions {
  container: RefObject<HTMLElement>;
  html: string;
  active: boolean;
  /** The block the open diagram viewer was read from, so a theme write can re-read it. */
  diagramBlock: RefObject<HTMLElement | null>;
  /**
   * The block the viewer is showing, re-rendered for the new palette.
   *
   * The caller reads it (`readDiagramBlock`) because the snapshot type belongs
   * to the viewer, not to hydration — this module never needs to know what a
   * diagram IS.
   */
  onDiagramBlock: (block: HTMLElement) => void;
}

/** Draw every `mermaid-block` placeholder, and re-draw on a palette change. */
export function useMermaidHydration({
  container,
  html,
  active,
  diagramBlock,
  onDiagramBlock,
}: MermaidHydrationOptions): void {
  useIsomorphicLayoutEffect(() => {
    if (!active || typeof window === 'undefined') return;
    const element = container.current;
    if (!element) return;

    let timer: number | undefined;
    const hydrate = async () => {
      if (!element.isConnected) return;
      await hydrateMermaidBlocks(element);
    };

    void hydrate();
    const observer = new MutationObserver(() => {
      if (element.isConnected) void hydrateMermaidBlocks(element, { cachedOnly: true });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void hydrate(), 120);
    });
    observer.observe(element, { childList: true });

    const rehydrateForTheme = async () => {
      await hydrate();
      const block = diagramBlock.current;
      // A timeline re-render can replace the block under an open viewer; keep
      // the last snapshot then rather than closing the viewer on the user.
      if (!block?.isConnected) return;
      onDiagramBlock(block);
    };
    const themeObserver = new MutationObserver(() => void rehydrateForTheme());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      themeObserver.disconnect();
    };
  }, [container, html, active, diagramBlock, onDiagramBlock]);
}

/**
 * Point every marked local image at the session's image route.
 *
 * `markLocalImageSources` moved the path off `src` before sanitization, so the
 * browser has not requested `/Users/…` (or been refused a `file:///…`); this is
 * the one place that turns the reference back into a URL. It re-runs on every
 * render because the timeline replaces the container's HTML on a streaming
 * frame, and it is idempotent — the attribute is read from the markup, not
 * remembered.
 */
export function useLocalImageSources(
  container: RefObject<HTMLElement>,
  html: string,
  sessionId: string | undefined,
): void {
  useIsomorphicLayoutEffect(() => {
    if (!sessionId || typeof window === 'undefined') return;
    const element = container.current;
    if (!element) return;
    for (const image of element.querySelectorAll<HTMLImageElement>(`img[${LOCAL_IMAGE_ATTR}]`)) {
      const reference = image.getAttribute(LOCAL_IMAGE_ATTR);
      if (!reference) continue;
      const src = sessionImageUrl(sessionId, reference);
      if (image.getAttribute('src') !== src) image.setAttribute('src', src);
      image.setAttribute('loading', 'lazy');
      image.setAttribute('decoding', 'async');
    }
  }, [container, html, sessionId]);
}
