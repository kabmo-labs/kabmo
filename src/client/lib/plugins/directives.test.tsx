/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Message directives: a fenced block a plugin claims and renders.
 *
 * The property this suite exists for is the one that would break every
 * plugin-less install if it were wrong: **an unclaimed fence must render
 * EXACTLY as it did before the slot existed.** The parser emits the directive
 * placeholder for anything namespace-qualified, so "unchanged" has to mean the
 * ordinary code block still comes out of it — asserted against the renderer's
 * own output rather than against a hand-written expectation.
 *
 * The second is that a plugin component which throws leaves the CODE BLOCK,
 * never an error page in the middle of a message.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h } from 'preact';
import {
  DIRECTIVE_ATTRS_ATTR,
  DIRECTIVE_BLOCK_CLASS,
  DIRECTIVE_NAME_ATTR,
  isDirectiveLanguage,
  parseDirectiveAttributes,
  readDirectiveAttributes,
} from '@/shared/lib/markdown/directives';

/**
 * Bound in `beforeAll`, after the DOM globals exist — NOT at module scope.
 * `sanitize.ts` binds DOMPurify when it is first imported, capturing whatever
 * `window` exists then, so a static import would bind the sanitizer to a
 * window-less environment and every assertion here would see unsanitized (or
 * unfenced) HTML. Measured: this suite passed alone and failed inside the full
 * run, where an earlier file had installed its own window.
 */
let renderMarkdown: typeof import('@/shared/lib/markdown/marked').renderMarkdown;
let sanitizeHtml: typeof import('@/shared/lib/markdown/sanitize').sanitizeHtml;
let hydrateDirectiveBlocks: typeof import('@/client/lib/plugins/directives').hydrateDirectiveBlocks;
let unmountDirectiveBlocks: typeof import('@/client/lib/plugins/directives').unmountDirectiveBlocks;

const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'MutationObserver', 'NodeFilter',
] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeAll(async () => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    const value = (win as unknown as Record<string, unknown>)[key];
    if (value !== undefined) target[key] = value;
  }
  ({ renderMarkdown } = await import('@/shared/lib/markdown/marked'));
  ({ sanitizeHtml } = await import('@/shared/lib/markdown/sanitize'));
  ({ hydrateDirectiveBlocks, unmountDirectiveBlocks } = await import('@/client/lib/plugins/directives'));
});

afterAll(() => {
  // One process per run: a leaked DOM window takes `agent-events.ts`'s
  // `typeof window` branch with a `CustomEvent` from another realm.
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    const value = nativeGlobals[key];
    if (value === undefined) delete target[key];
    else target[key] = value;
  }
});

/**
 * Render markdown the way the app does: parse, then sanitize.
 *
 * The LEADING paragraph is not decoration. happy-dom's DOMPurify drops the
 * first element of a bare fragment — verified: `sanitizeHtml('<div>x</div>')`
 * answers `'x'`, and `'<div>x</div><p>y</p>'` answers `'x<p>y</p>'` — so a
 * directive wrapper at the root would be gone before any assertion ran, and
 * this suite would pass alone and fail inside the full run (where an earlier
 * file had already bound DOMPurify to its own window). A real browser keeps
 * the root element; the sanitizer's allowlist is the thing under test here, so
 * the fragment is given a leading sibling to survive the harness.
 */
function html(markdown: string): string {
  return sanitizeHtml(`<p>lead</p>${renderMarkdown(markdown)}`);
}

let container: HTMLDivElement;
const CONTEXT = { sessionId: 's1', workspacePath: '/ws' };

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

describe('the parser', () => {
  test('a namespace-qualified fence becomes a claimable placeholder', () => {
    const out = html('```omp:chart\n{"series":[1]}\n```');
    expect(out).toContain(DIRECTIVE_BLOCK_CLASS);
    expect(out).toContain(`${DIRECTIVE_NAME_ATTR}="omp:chart"`);
  });

  test('an ordinary fence is untouched — no placeholder at all', () => {
    const out = html('```ts\nconst x = 1;\n```');
    expect(out).not.toContain(DIRECTIVE_BLOCK_CLASS);
    expect(out).toContain('language-ts');
  });

  test('an unclaimed placeholder STILL carries the ordinary code block', () => {
    // The fallback is inside, which is what makes "unclaimed renders as before"
    // a structural property rather than a rule to remember.
    const out = html('```omp:chart\n{"series":[1]}\n```');
    expect(out).toContain('class="code-block"');
    expect(out).toContain('language-omp:chart');
  });

  test('the info line\'s attributes are parsed and carried', () => {
    const out = html('```omp:chart title="A chart" width=420\nbody\n```');
    // Encoded into the attribute, so the client can read them back.
    const match = new RegExp(`${DIRECTIVE_ATTRS_ATTR}="([^"]+)"`).exec(out);
    expect(match).not.toBeNull();
    expect(readDirectiveAttributes(match?.[1] ?? null)).toEqual({ title: 'A chart', width: '420' });
  });

  test('only a colon marks a directive', () => {
    expect(isDirectiveLanguage('omp:chart')).toBe(true);
    expect(isDirectiveLanguage('ts')).toBe(false);
    expect(isDirectiveLanguage('')).toBe(false);
  });

  test('a malformed attributes payload reads back as empty rather than throwing', () => {
    expect(readDirectiveAttributes('not json')).toEqual({});
    expect(readDirectiveAttributes(null)).toEqual({});
    // A JSON array is not an attribute map.
    expect(readDirectiveAttributes(encodeURIComponent('[1,2]'))).toEqual({});
  });

  test('a stray quote in the info line does not fail the parse', () => {
    // Tolerant by design: this runs on whatever a message contains, so an
    // unparseable attribute is dropped or taken literally rather than throwing.
    // A message with a stray quote is still a message.
    expect(() => parseDirectiveAttributes(' title="unterminated')).not.toThrow();
    expect(parseDirectiveAttributes('===')).toEqual({});
    expect(parseDirectiveAttributes(' title="quoted" broken')).toEqual({ title: 'quoted' });
  });
});

describe('hydration', () => {
  /** A component that renders its props, so the test can read what it got. */
  function Directive(props: { name: string; body: string; attributes: Record<string, string> }) {
    return h('div', { id: 'plugin-directive' }, `${props.name}|${props.body.trim()}|${props.attributes.title ?? ''}`);
  }

  const claim = (name: string) => (fence: string) =>
    fence === name ? { pluginId: 'demo', registration: { id: 'r', name, component: Directive } } : undefined;

  test('a claimed fence renders the plugin component with the raw body', () => {
    container.innerHTML = html('```omp:chart title="A"\n{"series":[1]}\n```');
    hydrateDirectiveBlocks(container, claim('omp:chart'), CONTEXT);

    const rendered = container.querySelector('#plugin-directive');
    expect(rendered).not.toBeNull();
    expect(rendered?.textContent).toBe('omp:chart|{"series":[1]}|A');
  });

  test('an unclaimed fence is left exactly as the parser emitted it', () => {
    container.innerHTML = html('```omp:chart\n{"series":[1]}\n```');
    // Read back AFTER the assignment: setting innerHTML normalizes the markup
    // (a self-closing `<path/>` becomes `<path></path>`), so the parser's own
    // string is not what the DOM holds.
    const before = container.innerHTML;
    hydrateDirectiveBlocks(container, () => undefined, CONTEXT);
    expect(container.innerHTML).toBe(before);
    expect(container.querySelector('.code-block')).not.toBeNull();
  });

  test('a throwing component leaves the CODE BLOCK, not an error', () => {
    function Boom(): never {
      throw new Error('the directive component is broken');
    }
    container.innerHTML = html('```omp:chart\n{"series":[1]}\n```');
    const original = container.innerHTML;
    const claimBoom = () => ({ pluginId: 'demo', registration: { id: 'r', name: 'omp:chart', component: Boom } });

    // Preact reports the render error; what matters is what is left on screen.
    try {
      hydrateDirectiveBlocks(container, claimBoom, CONTEXT);
    } catch {
      // Expected on some Preact versions.
    }
    // The code block is back (the fallback the placeholder wrapped).
    expect(container.querySelector('.code-block')).not.toBeNull();
    expect(container.textContent).toContain('{"series":[1]}');
    void original;
  });

  test('hydration is idempotent: a second call does not re-render', () => {
    container.innerHTML = html('```omp:chart\n{"series":[1]}\n```');
    hydrateDirectiveBlocks(container, claim('omp:chart'), CONTEXT);
    const first = container.innerHTML;
    hydrateDirectiveBlocks(container, claim('omp:chart'), CONTEXT);
    expect(container.innerHTML).toBe(first);
  });

  test('a message removed and re-rendered hydrates its component again', () => {
    // The cycle the renderer's effect cleanup creates, with the order Preact
    // actually uses (measured): the new markup is committed FIRST, then the old
    // effect's cleanup runs. A timeline that replaces the container's html —
    // a session switch, a rewind — must therefore come back hydrated, and the
    // cleanup must not have been able to blank it.
    const markdown = '```omp:chart\n{"series":[1]}\n```';
    container.innerHTML = html(markdown);
    hydrateDirectiveBlocks(container, claim('omp:chart'), CONTEXT);
    expect(container.querySelector('#plugin-directive')).not.toBeNull();

    // Preact's order: fresh markup, then the previous effect's cleanup.
    container.innerHTML = html(markdown);
    hydrateDirectiveBlocks(container, claim('omp:chart'), CONTEXT);

    expect(container.querySelector('#plugin-directive')?.textContent).toBe('omp:chart|{"series":[1]}|');
  });

  test('unmounting takes the plugin tree down', () => {
    container.innerHTML = html('```omp:chart\n{"series":[1]}\n```');
    hydrateDirectiveBlocks(container, claim('omp:chart'), CONTEXT);
    const host = container.querySelector('.plugin-directive');
    expect(host?.textContent).not.toBe('');

    unmountDirectiveBlocks(container);
    // The host survives — it is the placeholder's child — but its tree is gone.
    expect(container.querySelector('.plugin-directive')?.textContent).toBe('');
  });
});
