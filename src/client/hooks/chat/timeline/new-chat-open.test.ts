/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The New Chat card's harness capture.
 *
 * The card has no harness picker, so the agent that owns the chat it was opened
 * FROM is the only source for the new chat's spawn. A capture that read the
 * current render instead of the open-time pick would silently change when the
 * sidebar's harness row settles — and a capture that was never taken spawned the
 * new chat on omp's RPC default.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { useNewChatOpen, type NewChatOpen, type NewChatOpenDeps } from '@/client/hooks/chat/timeline/new-chat-open';

let container: HTMLElement | undefined;
let hook: NewChatOpen | null = null;

function Probe({ deps }: { deps: NewChatOpenDeps }) {
  hook = useNewChatOpen(deps);
  return null;
}

async function mount(deps: NewChatOpenDeps): Promise<void> {
  container ??= document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(h(Probe, { deps }), container as HTMLElement);
  });
  await act(async () => {});
}

function deps(overrides: Partial<NewChatOpenDeps> = {}): NewChatOpenDeps {
  return { folders: [], sessionId: 'sess-aaa', selectedFolderId: null, ...overrides };
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterAll(() => {
  restoreDomGlobals();
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
  hook = null;
});

describe('useNewChatOpen', () => {
  test('captures the source chat harness at open time', async () => {
    await mount(deps({ harness: 'opencode' }));

    await act(async () => { hook?.open('halo'); });

    expect(hook?.content).toBe('halo');
    expect(hook?.harness).toBe('opencode');
  });

  test('a card opened from a chat with no resolved harness carries none', async () => {
    await mount(deps());

    await act(async () => { hook?.open('halo'); });

    expect(hook?.content).toBe('halo');
    expect(hook?.harness).toBeUndefined();
  });

  test('closing the card drops the capture with the content', async () => {
    await mount(deps({ harness: 'omp-acp' }));
    await act(async () => { hook?.open('halo'); });

    await act(async () => { hook?.close(); });

    expect(hook?.content).toBeNull();
    expect(hook?.harness).toBeUndefined();
  });
});
