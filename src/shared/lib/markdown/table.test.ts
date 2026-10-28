/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The scroll container around every rendered table.
 *
 * A table with long unbreakable cells (paths, hashes, URLs) is wider than the
 * message box it sits in — an auto-layout table cannot be narrowed below its
 * columns' min-content width, so `width: 100%` is a floor, not a ceiling — and
 * the chat timeline's scroller is `overflow-x-hidden`, which clipped its right
 * columns with no way to reach them. `renderMarkdown` therefore emits a
 * `.md-table-scroll` wrapper (styled in `tailwind.css`) whose own `overflow-x`
 * is what scrolls.
 *
 * Two things have to hold for that to work, and neither is visible from the CSS
 * alone: the wrapper must be emitted for EVERY table, and it must survive
 * `sanitizeHtml` — DOMPurify drops anything its profile does not know, and a
 * stripped `<div>`/`class` would leave the table clipped exactly as before.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { renderMarkdown as RenderMarkdown } from '@/shared/lib/markdown/marked';
import type { sanitizeHtml as SanitizeHtml } from '@/shared/lib/markdown/sanitize';

let renderMarkdown: typeof RenderMarkdown;
let sanitizeHtml: typeof SanitizeHtml;
/** Read from the module rather than spelled here: the renderer and the CSS are
 *  the only two places that class name may exist. */
let tableScrollClass: string;

const displaced: Record<string, unknown> = {};
const installed: Record<string, unknown> = {};

beforeAll(async () => {
  const win = new Window({ url: 'http://localhost' });
  for (const [key, value] of Object.entries({
    window: win,
    document: win.document,
    Node: win.Node,
    Element: win.Element,
    HTMLElement: win.HTMLElement,
  })) {
    displaced[key] = (globalThis as Record<string, unknown>)[key];
    installed[key] = value;
    (globalThis as Record<string, unknown>)[key] = value;
  }
  // Dynamic because this is a load-ORDER boundary, not a module selection:
  // `sanitize.ts` binds DOMPurify at module scope, so a static import would run
  // before these DOM globals exist and bind the sanitizer to a window-less
  // environment (where `sanitizeHtml` returns its input unsanitized).
  ({ renderMarkdown, TABLE_SCROLL_CLASS: tableScrollClass } = await import('@/shared/lib/markdown/marked'));
  ({ sanitizeHtml } = await import('@/shared/lib/markdown/sanitize'));
});

// The runner shares one process: a leaked happy-dom window would send every
// later file down a browser code path.
afterAll(() => {
  for (const key of Object.keys(installed)) {
    if (displaced[key] === undefined) delete (globalThis as Record<string, unknown>)[key];
    else (globalThis as Record<string, unknown>)[key] = displaced[key];
  }
});

const WIDE_TABLE = [
  '| endpoint | payload |',
  '| --- | --- |',
  '| `/api/settings/usage?refresh=1` | `a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90` |',
].join('\n');

/**
 * An answer-shaped message: leading prose, then the table. The prose is not
 * decoration — the sanitizer's happy-dom path unwraps the FIRST root element of
 * a fragment (verified there: `<div>x</div>` sanitizes to `x`, while Chromium
 * keeps it), so a fixture that opened on the table would drop the very wrapper
 * under test for a harness reason rather than a product one.
 */
const withProse = (markdown: string) => `Here is the report.\n\n${markdown}`;

/** Render + sanitize, then parse the result into a real DOM. */
function renderToDom(markdown: string, allowHtml = false): HTMLElement {
  const host = document.createElement('div');
  host.className = 'prose-content';
  host.innerHTML = sanitizeHtml(renderMarkdown(markdown, { allowHtml }));
  return host;
}

describe('markdown table scroll container', () => {
  test('the parser wraps a table in the scroll container', () => {
    const raw = renderMarkdown(WIDE_TABLE);
    expect(raw.startsWith(`<div class="${tableScrollClass}"><table>`)).toBe(true);
    // The table must be the wrapper's CHILD: the scroll rule is applied to the
    // wrapper, so a sibling arrangement would leave `overflow-x` on nothing.
    expect(raw.endsWith('</table>\n</div>')).toBe(true);
  });

  test('the wrapper survives sanitization with its class', () => {
    const host = renderToDom(withProse(WIDE_TABLE));
    const wrapper = host.querySelector<HTMLElement>(`.${tableScrollClass}`);

    expect(wrapper).not.toBeNull();
    // A stripped class is the failure this pins: the node alone is not enough,
    // since the scroll rule is keyed on the class name.
    expect(wrapper?.className).toBe(tableScrollClass);
    expect(wrapper?.firstElementChild?.tagName).toBe('TABLE');
  });

  test('the table keeps marked\'s own markup inside the wrapper', () => {
    const host = renderToDom(withProse(WIDE_TABLE));
    const wrapper = host.querySelector<HTMLElement>(`.${tableScrollClass}`);
    expect(wrapper?.querySelector('th')?.textContent).toBe('endpoint');
    expect(wrapper?.querySelectorAll('td')).toHaveLength(2);
    expect(wrapper?.querySelector('code.inline-code')?.textContent).toBe('/api/settings/usage?refresh=1');
  });

  test('every table gets its own wrapper', () => {
    const host = renderToDom(withProse(`${WIDE_TABLE}\n\ntext between\n\n${WIDE_TABLE}`));
    expect(host.querySelectorAll(`.${tableScrollClass}`)).toHaveLength(2);
    expect(host.querySelectorAll('table')).toHaveLength(2);
    expect(host.textContent).toContain('text between');
  });

  test('a document previews table is wrapped the same way', () => {
    // The editor preview and the wiki reader render through the same pipeline
    // with `allowHtml` on; the wrapper must not be an agent-output-only branch.
    const host = renderToDom(withProse(WIDE_TABLE), true);
    expect(host.querySelectorAll(`.${tableScrollClass}`)).toHaveLength(1);
  });

  test('prose without a table stays unwrapped', () => {
    const host = renderToDom('plain **text** and `code`');
    expect(host.querySelector(`.${tableScrollClass}`)).toBeNull();
  });
});
