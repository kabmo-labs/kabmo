/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * End-to-end coverage for lazy math rendering.
 *
 * KaTeX is no longer rendered during markdown parsing (it is a ~522 kB async
 * chunk), so the pipeline emits a `.math-pending` placeholder that
 * `hydrateMathBlocks` later swaps for real markup. That split has two failure
 * modes a unit test on either half alone would miss:
 *
 *   1. DOMPurify drops a bare root-level `<span>`, which silently deleted every
 *      block (`$$…$$`) formula and stripped KaTeX's outer `.katex` wrapper.
 *   2. The placeholder attributes (`data-math`, `data-math-display`) must survive
 *      `sanitizeHtml`, or hydration has nothing to read.
 *
 * These run against a real DOM (happy-dom) because both paths are DOM-dependent;
 * they are no-ops everywhere else.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

let hydrateMathBlocks: typeof import('@/shared/lib/markdown/katex').hydrateMathBlocks;
let renderMarkdown: typeof import('@/shared/lib/markdown/marked').renderMarkdown;
let sanitizeHtml: typeof import('@/shared/lib/markdown/sanitize').sanitizeHtml;

const displaced: Record<string, unknown> = {};
const installed: Record<string, unknown> = {};

beforeAll(async () => {
  const win = new Window({ url: 'http://localhost' });
  for (const [key, value] of Object.entries({
    window: win,
    document: win.document,
    MutationObserver: win.MutationObserver,
    Node: win.Node,
    Element: win.Element,
    HTMLElement: win.HTMLElement,
    NodeFilter: win.NodeFilter,
  })) {
    displaced[key] = (globalThis as Record<string, unknown>)[key];
    installed[key] = value;
    (globalThis as Record<string, unknown>)[key] = value;
  }
  // Dynamic import is required here, not stylistic: `sanitize.ts` binds
  // DOMPurify at module scope, which captures the DOM globals present at
  // evaluation time. A static import would run before the happy-dom globals
  // above exist and bind the sanitizer to a window-less environment.
  ({ hydrateMathBlocks } = await import('@/shared/lib/markdown/katex'));
  ({ renderMarkdown } = await import('@/shared/lib/markdown/marked'));
  ({ sanitizeHtml } = await import('@/shared/lib/markdown/sanitize'));
});

// Every test file shares one process, so the globals go back the way they were:
// the fold in `agent-events.ts` branches on `typeof window`, and a leaked DOM
// window would take its browser path with a `CustomEvent` from another realm.
afterAll(() => {
  for (const key of Object.keys(installed)) {
    if (displaced[key] === undefined) delete (globalThis as Record<string, unknown>)[key];
    else (globalThis as Record<string, unknown>)[key] = displaced[key];
  }
});

/** Render markdown and mount it exactly as `MarkdownRenderer` does. */
function mount(content: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = sanitizeHtml(renderMarkdown(content));
  document.body.appendChild(host);
  return host;
}

describe('lazy math rendering', () => {
  test('inline math survives sanitization and hydrates to KaTeX', async () => {
    const host = mount('rumus $E = mc^2$ disini');

    const placeholder = host.querySelector('.math-pending');
    expect(placeholder).not.toBeNull();
    // The payload travels percent-encoded (see `renderMathPlaceholder`), so the
    // assertion decodes rather than reading the attribute raw.
    expect(decodeURIComponent(placeholder?.getAttribute('data-math') ?? '')).toBe('E = mc^2');

    expect(await hydrateMathBlocks(host)).toEqual({ rendered: 1, failed: 0 });

    expect(host.querySelectorAll('.math-pending').length).toBe(0);
    // The outer wrapper is what every katex.css layout rule targets.
    expect(host.querySelector('.katex')).not.toBeNull();
    expect(host.querySelectorAll('.katex math').length).toBeGreaterThan(0);
  });

  test('block math renders in display mode', async () => {
    const host = mount('$$\\int_0^1 x^2 dx$$');

    const placeholder = host.querySelector('.math-pending');
    expect(placeholder).not.toBeNull();
    expect(placeholder?.getAttribute('data-math-display')).toBe('1');

    await hydrateMathBlocks(host);
    expect(host.querySelector('.katex-display')).not.toBeNull();
  });

  test('multiple formulas each hydrate', async () => {
    // `$$…$$` only parses as display math on its own line (see the flanking
    // rules in marked.ts), so the block case is a separate line here.
    const host = mount('$a$ dan $b$\n\n$$c$$');
    expect(host.querySelectorAll('.math-pending').length).toBe(3);

    expect((await hydrateMathBlocks(host)).rendered).toBe(3);
    expect(host.querySelectorAll('.katex').length).toBe(3);
  });

  test('no placeholders is a no-op', async () => {
    const host = mount('plain text, no math');
    expect(await hydrateMathBlocks(host)).toEqual({ rendered: 0, failed: 0 });
  });

  test('invalid LaTeX degrades without throwing', async () => {
    const host = mount('bad $\\frac{1}{$ here');
    await expect(hydrateMathBlocks(host)).resolves.toBeDefined();
  });

  test('escapes the tex source so it cannot break out of the attribute', () => {
    const html = renderMarkdown('a $x" onmouseover="alert(1)$ b');
    expect(html).not.toContain('onmouseover="alert');
  });

  // A lone `$` is the delimiter most likely to appear in ordinary text this
  // app renders all day — shell output, currency, SQL placeholders, awk
  // programs. Each of these was a formula before the flanking rules and the
  // remend inline healer were fixed, and the failure was not cosmetic: an odd
  // `$` count made the formula run to the END of the message.
  test('a single $ is text, never math', () => {
    for (const source of [
      'Hasil: $HOME',
      '$HOME',
      'Path ada di $HOME.',
      'Biaya $5.',
      'Pakai ${HOME}/bin',
      'SELECT * FROM t WHERE id = $1',
      "awk '{print $1, $2}' file",
      'PATH=$PATH:$HOME',
      'a$b$c',
    ]) {
      const host = mount(source);
      expect(host.querySelectorAll('.math-pending').length).toBe(0);
      expect(host.textContent).toBe(source);
    }
  });

  test('an unmatched $ does not run to the end of the message', () => {
    // remend's inline healer used to close the `$` at the very end of the
    // text, turning everything after it into one formula.
    const source = 'Hasil: $HOME lalu baris kedua biasa';
    const host = mount(source);
    expect(host.querySelectorAll('.math-pending').length).toBe(0);
    expect(host.textContent).toBe(source);
  });

  test('a $ in a fenced block leaves the closing fence intact', () => {
    const host = mount('```\necho $HOME\n```');
    const code = host.querySelector('pre code');
    expect(code?.textContent).toBe('echo $HOME');
    expect(host.querySelectorAll('.math-pending').length).toBe(0);
  });

  // `escapeHtmlOutsideCode` rewrites the source before marked parses it, so a
  // formula reached KaTeX as `x &lt; y` and rendered as a syntax error.
  test('entities in a formula reach KaTeX as the author wrote them', async () => {
    const host = mount('rumus $x < y$ dan $a \\& b$ benar');
    expect(host.querySelectorAll('.math-pending').length).toBe(2);

    await hydrateMathBlocks(host);
    expect(host.querySelectorAll('.katex-error').length).toBe(0);
    expect(host.querySelectorAll('.katex').length).toBe(2);
  });
});
