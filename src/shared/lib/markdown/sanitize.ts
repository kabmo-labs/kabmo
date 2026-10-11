/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DOMPurify sanitizer for rendered markdown HTML.
 *
 * The assistant is allowed to produce HTML but we never execute it: raw HTML
 * tags are stripped by default (DOMPurify default profile) while KaTeX's
 * MathML nodes are preserved via ADD_TAGS/ADD_ATTR. Sanitization is
 * client-only — in a non-DOM (SSR) environment we return the input unchanged
 * and let the browser dev server apply it on the client.
 */

import DOMPurify, { type Config } from 'dompurify';
import { DIRECTIVE_ATTRS_ATTR, DIRECTIVE_BLOCK_CLASS, DIRECTIVE_NAME_ATTR } from '@/shared/lib/markdown/directives';

const KATEX_MATHML_TAGS = [
  'math',
  'annotation',
  'annotation-xml',
  'semantics',
  'mrow',
  'mi',
  'mn',
  'mo',
  'mspace',
  'ms',
  'mtext',
  'mroot',
  'mfrac',
  'msqrt',
  'mstyle',
  'merror',
  'mpadded',
  'mphantom',
  'mtable',
  'mtr',
  'mtd',
  'mlabeledtr',
  'munder',
  'mover',
  'munderover',
  'msup',
  'msub',
  'msubsup',
  'mtext',
  'mtd',
  'menclose',
];

/** Whether KaTeX output is present — extends the allowlist for MathML. */
function hasKatex(html: string): boolean {
  return /class="[^"]*katex/.test(html);
}

/** Inline SVG icons emitted by the marked code-block copy button. */
const COPY_ICON_TAGS = ['svg', 'path', 'polyline', 'rect', 'circle', 'line'];
const COPY_ICON_ATTRS = [
  'viewBox', 'd', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r',
  'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'xmlns', 'aria-hidden', 'aria-label',
];

/** Mermaid diagram SVG shapes, text, edges, and metadata attributes. */
const MERMAID_TAGS = [
  'svg', 'g', 'line', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline',
  'text', 'tspan', 'title', 'desc', 'marker', 'defs', 'style', 'use', 'symbol',
  'foreignObject', 'html', 'head', 'body', 'div', 'span', 'p', 'br', 'img',
];
const MERMAID_ATTRS = [
  'id', 'class', 'style', 'transform', 'viewBox', 'width', 'height', 'xmlns',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points',
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'fill-opacity', 'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor',
  'dominant-baseline', 'alignment-baseline', 'text-decoration', 'direction',
  'marker-end', 'marker-start', 'marker-mid', 'markerWidth', 'markerHeight',
  'refX', 'refY', 'orient', 'markerUnits', 'preserveAspectRatio', 'version',
  'dx', 'dy', 'dy1', 'dy2', 'rowspan', 'colspan', 'start', 'aria-roledescription',
  'aria-describedby', 'role', 'aria-hidden', 'aria-label', 'data-mermaid-theme',
  'overflow', 'visibility', 'rel', 'src', 'alt',
];
const MERMAID_URI_ATTRS = ['href', 'xlink:href'];

function buildMermaidConfig(hasUri: boolean): Config {
  return {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    ADD_TAGS: MERMAID_TAGS,
    ADD_ATTR: [...MERMAID_ATTRS, ...(hasUri ? MERMAID_URI_ATTRS : [])],
    HTML_INTEGRATION_POINTS: { 'annotation-xml': true, foreignobject: true },
  };
}

/**
 * Sanitize a rendered markdown HTML string. Strips scripts/event handlers and
 * unknown tags (default profile) so assistant HTML is escaped, not executed.
 * KaTeX MathML + the code-copy icon SVG are preserved when present.
 */
export function sanitizeHtml(html: string): string {
  if (!html) return html;
  if (typeof window === 'undefined' || !window.document) return html;

  const hasSvgIcon = /<svg[^>]*>/.test(html);
  const hasMathPlaceholder = html.includes('math-pending');
  // A plugin directive's placeholder rides on the same allowlist shape as the
  // math placeholders: DOMPurify strips an unknown `data-*` attribute unless it
  // is listed, and a stripped name means the client cannot tell which plugin
  // claims the fence — the block would stay a code block forever.
  const hasDirective = html.includes(DIRECTIVE_BLOCK_CLASS);
  const config = hasKatex(html) || hasSvgIcon || hasMathPlaceholder || hasDirective
    ? {
        USE_PROFILES: { html: true, mathMl: true } as const,
        ADD_TAGS: [...KATEX_MATHML_TAGS, ...(hasSvgIcon ? COPY_ICON_TAGS : [])],
        ADD_ATTR: [
          'aria-hidden',
          'aria-label',
          'encoding',
          'nonce',
          // Math placeholders carry the TeX source and display flag for the
          // lazy KaTeX pass; DOMPurify strips unknown data-* attributes unless
          // they are listed here.
          'data-math',
          'data-math-display',
          ...(hasDirective ? [DIRECTIVE_NAME_ATTR, DIRECTIVE_ATTRS_ATTR, 'data-hydrated'] : []),
          ...(hasSvgIcon ? COPY_ICON_ATTRS : []),
        ],
      }
    : { USE_PROFILES: { html: true } as const };

  try {
    return DOMPurify.sanitize(html, config);
  } catch {
    return html;
  }
}

/**
 * Sanitize a mermaid-rendered SVG string. Mermaid with `securityLevel:
 * 'strict'` already strips scripts and event handlers, but defense in depth:
 * DOMPurify with an SVG allowlist tuned for mermaid output keeps diagram
 * shapes/text/edges while dropping anything outside it. Returns the input
 * unchanged in non-DOM (SSR) environments.
 */
export function sanitizeMermaidSvg(svg: string): string {
  if (!svg) return svg;
  if (typeof window === 'undefined' || !window.document) return svg;

  const hasUri = /href/.test(svg);
  try {
    return DOMPurify.sanitize(svg, buildMermaidConfig(hasUri));
  } catch {
    return svg;
  }
}

/**
 * Sanitize a KaTeX-rendered HTML fragment before it is injected via innerHTML.
 *
 * `sanitizeHtml` already allows the MathML profile when the *parsed markdown*
 * contains KaTeX classes, but lazy math rendering injects after that pass, so
 * the generated fragment is sanitized separately.
 *
 * `class` MUST be allowed: KaTeX's visual layout is entirely class-driven
 * (`.katex`, `.katex-mathml`, `.katex-html`), and DOMPurify drops attributes it
 * has not been told about. Without it the wrapper spans are stripped and only
 * bare MathML survives, which renders unstyled.
 */
export function sanitizeKatexHtml(html: string): string {
  if (!html) return html;
  if (typeof window === 'undefined' || !window.document) return html;

  // DOMPurify drops a bare root-level <span>, which would strip KaTeX's outer
  // `.katex` wrapper — the element every layout rule in katex.css hangs off.
  // Wrapping the fragment keeps the parser from discarding it; the wrapper is
  // removed again afterwards so only the KaTeX markup is injected.
  const wrapped = `<div data-katex-wrap>${html}</div>`;
  try {
    const clean = DOMPurify.sanitize(wrapped, {
      USE_PROFILES: { html: true, mathMl: true },
      ADD_ATTR: ['class', 'aria-hidden', 'encoding', 'style', 'data-katex-wrap'],
    } as Config);
    const host = document.createElement('div');
    host.innerHTML = clean;
    return host.querySelector('[data-katex-wrap]')?.innerHTML ?? clean;
  } catch {
    return html;
  }
}
