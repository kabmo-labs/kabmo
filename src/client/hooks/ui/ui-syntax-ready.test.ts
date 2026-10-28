/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/** The syntax-highlighter readiness hook: it reports the module state
 * at mount and follows the boot notification. Split verbatim from
 * `ui-listeners.test.ts` so both files stay under the repo's 350-line
 * ceiling. */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useSyntaxReady } from '@/client/hooks/ui/syntax-ready';
import { bootSyntax, isSyntaxReady } from '@/shared/lib/code/highlighter';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
/** The runner's own globals, restored on teardown (see the matching afterAll at the end of this file) so later files still see native Event/CustomEvent/window. */
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let win: Window;
let container: HTMLElement;

async function mount(vnode: Parameters<typeof render>[0]) {
  container ??= document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(vnode, container as HTMLElement);
  });
}

function SyntaxProbe({ seen }: { seen: { current: boolean | null } }) {
  seen.current = useSyntaxReady();
  return h('span', null, String(seen.current));
}

beforeAll(() => {
  win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

describe('useSyntaxReady', () => {
  test('reports the module readiness at mount and follows the boot notification', async () => {
    const seen: { current: boolean | null } = { current: null };
    await mount(h(SyntaxProbe, { seen }));
    // Readiness is process-global and may already have been reached by another
    // suite in this run; the hook must report it, not a hardcoded false.
    expect(seen.current).toBe(isSyntaxReady());

    await bootSyntax();
    for (let i = 0; i < 5; i += 1) await act(async () => {});
    expect(seen.current).toBe(true);
    expect(isSyntaxReady()).toBe(true);
  });
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});
