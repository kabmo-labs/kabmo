/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The "Full output" reader renders each artifact shape through its own surface.
 *
 * The classifier's decision is pinned in `artifact-view.test.ts`; what this
 * pins is that the body ACTS on it — a JSON body arrives pretty-printed inside
 * the JSON block rather than as a `<pre>` of its source, markdown goes through
 * the markdown pipeline, and a numbered excerpt puts its numbers in a gutter
 * instead of leaving `121|` welded onto the code. Rendered with `h()` against
 * happy-dom, following the harness in `panels/Todo.test.ts`.
 *
 * `ArtifactBody` is imported DYNAMICALLY, after the DOM globals exist: the
 * markdown pipeline (`sanitize.ts`) binds DOMPurify at module scope, so a
 * static import evaluated in the runner's window-less realm makes every render
 * under the test's happy-dom a no-op — which is exactly how this file failed
 * in a full-suite run while passing alone.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import type { ComponentType } from 'preact/compat';
import { act } from 'preact/test-utils';

let ArtifactBody: ComponentType<{ text: string; path?: string }>;

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
let container: HTMLElement;

beforeAll(async () => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  // Dynamic on purpose (same reason `math.test.ts` does it): `sanitize.ts`
  // binds DOMPurify at module scope, so the import must run AFTER the
  // happy-dom globals exist or the sanitizer holds the runner's window-less
  // realm and every render under the test's DOM is a no-op.
  ({ ArtifactBody } = await import('@/client/components/workspace/chat-timeline/tool-renderers/shared/ArtifactBody'));
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

async function mount(text: string, path = '') {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(ArtifactBody, { text, path }), container);
  });
  return container;
}

describe('artifact body', () => {
  test('pretty-prints a JSON artifact instead of showing its raw source', async () => {
    const el = await mount('{"a":1,"b":[2,3]}');
    const text = el.textContent ?? '';
    // Pretty-printed: the compact form has no newline at all.
    expect(text).toContain('"a": 1');
    expect(text).not.toContain('{"a":1');
  });

  test('renders markdown through the markdown pipeline, not as source', async () => {
    const el = await mount('**bold** and `code`\n\n- one\n- two');
    const prose = el.querySelector('.prose-content');
    expect(prose).not.toBeNull();
    // The markers are consumed by the parser and become elements. (Asserted on
    // `strong`/`li`, not on a heading: happy-dom's DOMPurify profile drops
    // heading tags, which is a harness artifact rather than the product's
    // behaviour — the real browser renders the `<h1>`.)
    expect(prose?.querySelector('strong')?.textContent).toBe('bold');
    expect(prose?.querySelectorAll('li').length).toBe(2);
    expect(el.textContent ?? '').not.toContain('**bold**');
  });

  test("puts a numbered excerpt's numbers in a gutter, not in the code", async () => {
    const el = await mount(['121:function f() {', '122:  return 1;', '123:}'].join('\n'), 'src/x.ts');
    const gutter = Array.from(el.querySelectorAll('div[aria-hidden="true"]'))
      .map((g) => g.textContent ?? '')
      .join('|');
    expect(gutter).toContain('121');
    expect(gutter).toContain('123');
    expect(el.textContent ?? '').not.toContain('121:function');
  });

  test('leaves a plain log as verbatim text', async () => {
    const el = await mount('error: rpc down\n    at /a/b.ts:12:3');
    expect(el.textContent ?? '').toContain('error: rpc down');
    expect(el.querySelector('.prose-content')).toBeNull();
  });
});
