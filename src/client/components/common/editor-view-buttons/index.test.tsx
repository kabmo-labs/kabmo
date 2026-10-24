/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two width-mode buttons, driven through the REAL session-state provider.
 *
 * Three properties only a mount can see, and each fails silently:
 *
 * - The two toolbars draw the SAME state. `useSessionState` hands every caller
 *   a private copy, so a version reading it would leave the diff toolbar
 *   showing `normal` after the editor toolbar entered compact view — two
 *   buttons disagreeing about one layout.
 * - Each button reports `aria-pressed` for its own mode and nothing else, so
 *   the pair reads as a mode selection rather than as two unrelated switches.
 * - Clicking the ACTIVE mode returns to `normal`, which is the only way back to
 *   a layout with the chat on screen without hunting for the other button.
 *
 * Rendered with `h()` against happy-dom, over a stubbed `fetch` that answers
 * the session-state blob (the provider loads it before anything is ready).
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { EditorViewButtons } from '@/client/components/common/editor-view-buttons';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { forgetSession } from '@/shared/lib/workspace/session-state/store';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const SESSION = 'new-editor-view-buttons';
/** The runner's own fetch, reached through `Bun` so a leaked stub cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  forgetSession(SESSION);
  (globalThis as unknown as Record<string, unknown>).fetch = nativeFetch;
});

afterAll(() => {
  restoreDomGlobals();
});

/**
 * Mount TWO button pairs under one provider — the editor toolbar's and the diff
 * toolbar's — because "they share one slot" is the claim, and a single pair
 * could pass with private copies.
 */
async function mount(stored: Record<string, unknown> = {}): Promise<void> {
  const target = globalThis as unknown as Record<string, unknown>;
  target.fetch = async () => {
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    return json({ sessionId: SESSION, state: stored });
  };

  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: SESSION,
        children: h(
          'div',
          null,
          h('div', { id: 'editor-toolbar' }, h(EditorViewButtons, { size: 14 })),
          h('div', { id: 'diff-toolbar' }, h(EditorViewButtons, { size: 13 })),
        ),
      }),
      container,
    );
  });
  // The provider's blob load settles across a tick.
  for (let i = 0; i < 10; i += 1) await act(async () => {});
}

/** The named button inside one of the two toolbar hosts. */
function button(toolbar: 'editor-toolbar' | 'diff-toolbar', name: string): HTMLButtonElement {
  const host = container.querySelector(`#${toolbar}`);
  const found = [...(host?.querySelectorAll('button') ?? [])].find(
    (el) => el.getAttribute('aria-label') === name,
  );
  if (!found) throw new Error(`no "${name}" button in #${toolbar}`);
  return found as HTMLButtonElement;
}

async function click(el: HTMLButtonElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }) as never);
  });
}

describe('EditorViewButtons', () => {
  test('both toolbars offer both modes, and neither is pressed by default', async () => {
    await mount();

    for (const toolbar of ['editor-toolbar', 'diff-toolbar'] as const) {
      expect(button(toolbar, 'Compact view').getAttribute('aria-pressed')).toBe('false');
      expect(button(toolbar, 'Full view').getAttribute('aria-pressed')).toBe('false');
    }
  });

  test('a click enters the mode, and the OTHER toolbar shows the same state', async () => {
    await mount();
    await click(button('editor-toolbar', 'Compact view'));

    expect(button('editor-toolbar', 'Compact view').getAttribute('aria-pressed')).toBe('true');
    expect(button('diff-toolbar', 'Compact view').getAttribute('aria-pressed')).toBe('true');
    expect(button('diff-toolbar', 'Full view').getAttribute('aria-pressed')).toBe('false');
  });

  test('the two modes are exclusive: entering one clears the other', async () => {
    await mount();
    await click(button('editor-toolbar', 'Compact view'));
    await click(button('diff-toolbar', 'Full view'));

    expect(button('editor-toolbar', 'Compact view').getAttribute('aria-pressed')).toBe('false');
    expect(button('editor-toolbar', 'Full view').getAttribute('aria-pressed')).toBe('true');
  });

  test('clicking the active mode returns to the ordinary layout', async () => {
    await mount();
    await click(button('editor-toolbar', 'Full view'));
    await click(button('editor-toolbar', 'Full view'));

    expect(button('editor-toolbar', 'Full view').getAttribute('aria-pressed')).toBe('false');
    expect(button('editor-toolbar', 'Compact view').getAttribute('aria-pressed')).toBe('false');
  });

  test('a mode stored for this session is restored on mount', async () => {
    await mount({ 'layout.editorViewMode': 'full' });

    expect(button('editor-toolbar', 'Full view').getAttribute('aria-pressed')).toBe('true');
    expect(button('diff-toolbar', 'Full view').getAttribute('aria-pressed')).toBe('true');
  });
});
