/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A row Kabmo wrote must not read as a row a person wrote.
 *
 * Both halves are pinned through the rendered DOM, because the bug was a
 * decision made at a call site: a delegating message is an orchestration
 * contract PREPENDED to the operator's sentence, and a child outcome is a card
 * with no operator text at all. Drawing either as a user bubble put Kabmo's own
 * machinery — a shell heredoc, a worker report from a session nobody is looking
 * at — in the mouth of the person reading the transcript.
 *
 * Rendered with `h()` against happy-dom, the same way the notice and gutter
 * suites do.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { UserTurn } from '@/client/components/workspace/chat-timeline/UserTurn';
import {
  ORCHESTRATION_CONTRACT,
  WORKER_BRIEF,
  renderChildOutcomeNotice,
} from '@/shared/lib/chat/orchestration/notice';
import type { ChatMessageData } from '@/shared/types';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

let container: HTMLElement | null = null;

afterEach(() => {
  if (container) {
    act(() => render(null, container as HTMLElement));
    container.remove();
    container = null;
  }
});

function mount(content: string): HTMLElement {
  container = document.body.appendChild(document.createElement('div'));
  const msg = { id: 'm1', role: 'user', content } as ChatMessageData;
  act(() =>
    render(
      h(UserTurn, {
        msg,
        content,
        isMobile: false,
        userActions: true,
        canFork: false,
        className: '',
      }),
      container as HTMLElement,
    ),
  );
  return container;
}

describe('an injected prompt renders as a card, not a bubble', () => {
  test('a child outcome has no operator bubble at all', () => {
    const root = mount(
      renderChildOutcomeNotice([
        { sessionId: 'c1', status: 'failed', failure: '400 The model is unavailable.' },
      ]),
    );
    const text = root.textContent ?? '';
    expect(text).toContain('Worker outcome');
    expect(text).toContain('Failed');
    // The card's subtitle names the worker; no bubble and no toolbar, because
    // the operator wrote none of this row.
    expect(root.querySelector('button[aria-label="Undo this message"]')).toBeNull();
  });

  test('the operator keeps their own words beside the contract', () => {
    const content = [
      ORCHESTRATION_CONTRACT.open,
      'You are the orchestrator for this message.',
      ORCHESTRATION_CONTRACT.close,
      '',
      'koordinasikan timnya',
    ].join('\n');
    const root = mount(content);
    const text = root.textContent ?? '';
    expect(text).toContain('Orchestration');
    expect(text).toContain('koordinasikan timnya');
    // The contract's own instructions never become the visible bubble text.
    expect(root.innerHTML).not.toContain('You are the orchestrator for this message.');
  });

  test('a worker brief is one card and never a bubble', () => {
    const root = mount(
      `${WORKER_BRIEF.open}\nYou are session c1.\n\nTASK\ncheck the log\n${WORKER_BRIEF.close}`,
    );
    expect(root.textContent).toContain('Dispatched worker');
    expect(root.querySelector('button[aria-label="Undo this message"]')).toBeNull();
  });

  test('an ordinary user message keeps its bubble and its toolbar', () => {
    const root = mount('just fix the test please');
    const text = root.textContent ?? '';
    expect(text).toContain('just fix the test please');
    expect(root.querySelector('button[aria-label="Undo this message"]')).not.toBeNull();
  });
});
