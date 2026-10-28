/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Read a hydrated `.mermaid-block` (see `@/shared/lib/markdown/mermaid`) back
 * out as a self-contained snapshot: the sanitized SVG markup plus the natural
 * pixel size mermaid gave it. Markup + size is all the viewer needs, so it
 * renders its own copy of the diagram instead of moving the timeline node — the
 * inline block keeps its theme, its copy button, and its place in the layout.
 */

export interface DiagramSnapshot {
  /** Sanitized `<svg …>` markup, exactly as the inline block renders it. */
  svg: string;
  /** Natural diagram width in px (the transform's 100% reference). */
  width: number;
  /** Natural diagram height in px. */
  height: number;
}

/** `null` while the block is pending/rendering/failed — it has no direct SVG
 *  child until `mermaid.ts` has swapped one in. */
export function readDiagramBlock(block: HTMLElement): DiagramSnapshot | null {
  const svg = block.querySelector<SVGSVGElement>(':scope > svg');
  if (!svg) return null;
  return { svg: svg.outerHTML, ...measure(svg) };
}

/**
 * Mermaid writes numeric px `width`/`height` attributes (the app configures
 * `useMaxWidth: false`), but a `viewBox`-only diagram is valid SVG too, and a
 * detached SVG reports a 0×0 border box — hence the fallback chain.
 */
function measure(svg: SVGSVGElement): { width: number; height: number } {
  const box = svg.viewBox?.baseVal;
  const rendered = svg.getBoundingClientRect();
  return {
    width: positive(svg.getAttribute('width'), box?.width, rendered.width),
    height: positive(svg.getAttribute('height'), box?.height, rendered.height),
  };
}

/** First candidate that resolves to a usable positive number; 1 otherwise, so
 *  callers can never divide by a zero-sized diagram. */
function positive(...candidates: (string | number | null | undefined)[]): number {
  for (const candidate of candidates) {
    const value = typeof candidate === 'number' ? candidate : Number.parseFloat(candidate ?? '');
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 1;
}
