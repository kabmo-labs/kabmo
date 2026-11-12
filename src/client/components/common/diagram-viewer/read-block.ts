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
 * Mermaid writes numeric px `width`/`height` attributes only for the diagram
 * types whose `useMaxWidth` is off — the app pins it off for flowcharts and
 * sequence diagrams. Every other type (class, state, ER, mindmap, timeline,
 * gantt, pie, …) keeps `useMaxWidth` on and emits `width="100%"`, no `height`,
 * the natural size in `style="max-width: Npx"`, and the `viewBox`.
 *
 * `Number.parseFloat('100%')` is 100, so reading that attribute as a pixel size
 * sized the viewer's canvas to 100 px: the diagram was drawn 100 px wide and
 * the zoom magnified that tiny rendering into a blurry bitmap. A percentage is
 * not a pixel size — only a unitless or `px` number is.
 */
function px(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (!value) return null;
  const match = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/.exec(value);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** The `viewBox`'s width/height, which is the natural size for a diagram that
 *  declares `width="100%"`. Read from the attribute rather than
 *  `svg.viewBox.baseVal` so a detached SVG (and a DOM without the SVG geometry
 *  API) still measures. */
function viewBoxSize(svg: SVGSVGElement): { width: number; height: number } | null {
  const raw = svg.getAttribute('viewBox');
  if (!raw) return null;
  const parts = raw.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  return { width: parts[2], height: parts[3] };
}

/**
 * The natural size, in order of trust: a real px attribute, the `viewBox`, then
 * the rendered box (a `viewBox`-only diagram is valid SVG too, and a detached
 * SVG reports a 0×0 border box). 1 is the floor, so callers can never divide by
 * a zero-sized diagram.
 */
function measure(svg: SVGSVGElement): { width: number; height: number } {
  const box = viewBoxSize(svg);
  const rendered = svg.getBoundingClientRect();
  return {
    width: px(svg.getAttribute('width')) ?? px(box?.width) ?? px(rendered.width) ?? 1,
    height: px(svg.getAttribute('height')) ?? px(box?.height) ?? px(rendered.height) ?? 1,
  };
}
