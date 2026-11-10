/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The assistant run footer's Fork action.
 *
 * The footer already carries a `msgId`, but it is the run's OPENING user row
 * (Retry rewinds there). Forking at that anchor branches BEFORE the answer the
 * button sits under, so the footer's fork has to use the run's owner row. These
 * pin the anchor on both the desktop strip and the phone sheet — the same
 * handler feeds both, and a future call site that passes only `msgId` must not
 * silently fork at the wrong place.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { RunFooter } from '@/client/components/workspace/chat-timeline/RunFooter';
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

function mount(node: preact.ComponentChild): HTMLElement {
  act(() => {
    render(node, container);
  });
  return container;
}

const answerRow: ChatMessageData = {
  id: 'ai-7',
  role: 'ai',
  content: 'the answer',
  model: 'gpt-5',
  provider: 'openai',
};

describe('assistant footer fork', () => {
  test('desktop forks at the run owner row, not the Retry anchor', () => {
    const calls: string[] = [];
    const el = mount(h(RunFooter, {
      msg: answerRow,
      retryTargetId: 'user-3',
      onFork: (id) => calls.push(id),
    }));

    const fork = el.querySelector('button[aria-label="Fork session from this answer"]') as HTMLButtonElement | null;
    expect(fork).not.toBeNull();
    act(() => fork!.click());

    expect(calls).toEqual(['ai-7']);
  });

  test('the phone sheet offers the same fork action', () => {
    const calls: string[] = [];
    const el = mount(h(RunFooter, {
      msg: answerRow,
      retryTargetId: 'user-3',
      isMobile: true,
      onFork: (id) => calls.push(id),
    }));

    act(() => {
      (el.querySelector('button[aria-label="More actions"]') as HTMLButtonElement).click();
    });
    const fork = el.querySelector('button[aria-label="Fork session from this answer"]') as HTMLButtonElement | null;
    expect(fork).not.toBeNull();
    act(() => fork!.click());

    expect(calls).toEqual(['ai-7']);
  });

  test('no onFork keeps the strip unchanged', () => {
    const el = mount(h(RunFooter, { msg: answerRow, retryTargetId: 'user-3' }));
    expect(el.querySelector('button[aria-label="Fork session from this answer"]')).toBeNull();
  });
});
