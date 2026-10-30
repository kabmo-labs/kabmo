/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A thinking block's open state belongs to the conversation, not to the mounted
 * component instance.
 *
 * The defect this pins: the accordion kept its openness in a local
 * `useState`, and `MessageList` mounts a WINDOW of rows. Expanding a thought
 * grows its row, the next measurement moves the viewport, the row leaves the
 * window and comes back with a fresh `useState(false)` — so the block snapped
 * shut, and whether it did depended on how much content sat below it ("sometimes
 * it works"). Measured in the browser on a real session: one click removed and
 * re-added every row at the window's edge.
 *
 * Mounted against happy-dom and driven through the rendered button, because the
 * claim is about what a click on the real control does across a remount.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ThinkingSection } from '@/client/components/workspace/chat-timeline/ThinkingSection';
import { SessionStateProvider } from '@/client/components/common/session-state-provider';
import { forgetSession } from '@/shared/lib/workspace/session-state/store';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const SESSION = 'spec-thinking-open';
/** The runner's own fetch, so a leaked stub cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

let container: HTMLElement;

const THOUGHT = { thought: 'Read the summary module, then patch the header row.', duration: '1.2s' };

beforeAll(() => installDomGlobals(new Window({ url: 'http://localhost' })));
afterAll(() => restoreDomGlobals());

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  (globalThis as unknown as Record<string, unknown>).fetch = async () =>
    new Response(JSON.stringify({ sessionId: SESSION, state: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
});

afterEach(() => {
  render(null, container);
  container.remove();
  forgetSession(SESSION);
  (globalThis as unknown as Record<string, unknown>).fetch = nativeFetch;
});

async function mount(messageId: string, thinking: typeof THOUGHT & { isGenerating?: boolean } = THOUGHT): Promise<void> {
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: SESSION,
        children: h(ThinkingSection, { thinking, messageId }),
      }) as never,
      container,
    );
  });
  for (let i = 0; i < 4; i += 1) await act(async () => {});
}

function toggle(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('button[aria-expanded]');
  if (!button) throw new Error('no thinking toggle');
  return button;
}

async function click(): Promise<void> {
  await act(async () => { toggle().click(); });
}

describe('thinking open state', () => {
  test('a block starts closed and a click opens it', async () => {
    await mount('m1');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    await click();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  test('the choice survives the row being unmounted and remounted', async () => {
    await mount('m1');
    await click();
    // What the timeline's row window does when the expanded row grows and the
    // reader moves: the row leaves the DOM and comes back.
    render(null, container);
    await mount('m1');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  test('each row remembers its own choice', async () => {
    await mount('m1');
    await click();
    render(null, container);
    await mount('m2');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  test('a generating run opens itself, and closing it during the run sticks', async () => {
    await mount('m1', { ...THOUGHT, isGenerating: true });
    expect(toggle().getAttribute('aria-expanded')).toBe('true');

    // The reader closes it mid-run. The run is still generating, so a default
    // re-applied on the next frame would re-open it under their cursor.
    await click();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });
});
