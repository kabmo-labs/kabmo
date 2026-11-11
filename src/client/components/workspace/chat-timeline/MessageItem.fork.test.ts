/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The user row's Fork action is drawn only where the harness can fork at a
 * user turn. omp cuts its own JSONL at any turn; the AIR adapters (claude,
 * codex) only take an assistant message; every other agent forks the whole
 * chat, which is the "Fork from" picker's job, not a per-row button.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ChatMessageItem } from '@/client/components/workspace/chat-timeline/MessageItem';
import { SessionStateProvider } from '@/client/components/common/session-state-provider';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { ChatMessageData } from '@/shared/types';

let container: HTMLElement;

beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  container = document.body.appendChild(document.createElement('div'));
});

afterEach(() => {
  render(null, container);
  container.remove();
});

afterAll(() => restoreDomGlobals());

const userRow: ChatMessageData = { id: 'u1', role: 'user', content: 'hello' };

function mount(harness?: string): { el: HTMLElement; calls: Array<[string, string]> } {
  const calls: Array<[string, string]> = [];
  act(() => {
    render(
      h(SessionStateProvider, {
        sessionId: 'fork-test',
        children: h(ChatMessageItem, {
          msg: userRow,
          onFork: (id, role) => calls.push([id, role]),
          ...(harness ? { harness } : {}),
        }),
      }),
      container,
    );
  });
  return { el: container, calls };
}

const FORK = 'button[aria-label="Fork this session from this message"]';

describe('user row fork visibility', () => {
  test('omp offers Fork on a user turn and anchors at that row', () => {
    const { el, calls } = mount('omp-rpc');
    const fork = el.querySelector(FORK) as HTMLButtonElement | null;
    expect(fork).not.toBeNull();
    act(() => fork!.click());
    expect(calls).toEqual([['u1', 'user']]);
  });

  test('an AIR adapter has no fork point on a user turn', () => {
    expect(mount('claude').el.querySelector(FORK)).toBeNull();
    expect(mount('codex').el.querySelector(FORK)).toBeNull();
  });

  test('a harness that can only fork the whole chat draws no per-row Fork', () => {
    expect(mount('zcode').el.querySelector(FORK)).toBeNull();
    expect(mount('opencode').el.querySelector(FORK)).toBeNull();
  });

  test('an unresolved harness keeps the historical button', () => {
    expect(mount().el.querySelector(FORK)).not.toBeNull();
  });
});
