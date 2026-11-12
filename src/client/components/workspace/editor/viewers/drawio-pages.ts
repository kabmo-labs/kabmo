/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A `.drawio` file → one SVG per page, or the reason it could not be read.
 *
 * Split from `DrawioView` so the part Kabmo owns is testable without a DOM:
 * the library is pure string → string, and the only decisions here are which
 * pages to draw, what to call them, and how a refusal is worded. The component
 * is then just the chrome around this result.
 */

import { DrawioError, parseDrawio, render } from '@dskripchenko/drawio';

export interface RenderedPage {
  name: string;
  svg: string;
  /** The drawn size, in CSS pixels. The stage fits the whole page against it. */
  width: number;
  height: number;
  warnings: string[];
}

export type DrawioPagesResult =
  | { status: 'ready'; pages: RenderedPage[] }
  | { status: 'error'; message: string };

/** The library's error carries where the file is wrong; that is the useful part. */
function describe(error: unknown): string {
  if (error instanceof DrawioError) {
    const at = error.line > 0 ? ` (line ${error.line}${error.column > 0 ? `, column ${error.column}` : ''})` : '';
    return `${error.message}${at}${error.hint ? ` — ${error.hint}` : ''}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every page of the file, in document order.
 *
 * `prefix` namespaces the ids inside each SVG: a file can be on screen twice
 * (two tabs), and a shared namespace would make the second SVG's `url(#…)`
 * references resolve to the first one's definitions.
 */
export function renderDrawioPages(content: string, prefix: string): DrawioPagesResult {
  try {
    const file = parseDrawio(content);
    const pages = file.pages.map((page, index) => {
      const result = render(file, { page: index, padding: 16, idPrefix: `${prefix}${index}-` });
      return {
        name: page.name || `Page ${index + 1}`,
        svg: result.svg,
        width: result.width,
        height: result.height,
        warnings: result.warnings,
      };
    });
    return { status: 'ready', pages };
  } catch (error) {
    return { status: 'error', message: describe(error) };
  }
}
