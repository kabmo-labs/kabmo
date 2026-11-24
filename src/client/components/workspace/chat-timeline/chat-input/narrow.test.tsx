/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The desktop composer with no room for its toolbar labels.
 *
 * The card is wider than the window can say: the chat column is draggable and
 * the right panel takes its own share, so a 1440px desktop can hold a 360px
 * composer. Measured at a 521px card, the `@[420px]` container queries turned
 * every label on at a width where the row could not hold them: the model chip
 * squeezed to 41px and `kenari` painted over the thinking chip beside it.
 *
 * These pin the replacement — the card's measured width, not a CSS query, picks
 * the PHONE arrangement. Narrow: icon-only chips and Plan/Goal in the attachment
 * row. Wide: labels in the toolbar and no Plan/Goal above the draft. One
 * verdict, so the two rows cannot disagree about the same card.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ChatInput } from '@/client/components/workspace/chat-timeline/chat-input';
import type { ComposerModes } from '@/client/components/workspace/chat-timeline/chat-input/modes-props';
import { delay } from '@/client/hooks/chat/composer/file-reads';
import { restoreRealtime, silenceRealtime } from '@/test-support/silent-socket';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
const nativeResizeObserver = (globalThis as unknown as Record<string, unknown>).ResizeObserver;

class FakeResizeObserver {
  static latest: FakeResizeObserver | null = null;
  disconnected = false;
  constructor(private readonly callback: (entries: Array<{ contentRect: { width: number } }>) => void) {
    FakeResizeObserver.latest = this;
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  fire(width: number) {
    this.callback([{ contentRect: { width } }]);
  }
}

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  target.ResizeObserver = FakeResizeObserver;
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
  if (nativeResizeObserver === undefined) delete target.ResizeObserver;
  else target.ResizeObserver = nativeResizeObserver;
});

let container: HTMLElement | null = null;

beforeEach(() => {
  silenceRealtime();
  FakeResizeObserver.latest = null;
});

afterEach(async () => {
  const host = container;
  if (host) {
    await act(async () => { render(null, host); });
    host.remove();
  }
  container = null;
  restoreRealtime();
  await delay(50);
});

function modes(): ComposerModes {
  return {
    plan: false,
    goal: false,
    goalOpen: false,
    goalRecord: null,
    goalContinuation: null,
    goalEvaluating: false,
    goalArm: null,
    disarmGoal: () => {},
    pending: false,
    planAvailable: true,
    goalAvailable: true,
    error: null,
    clearError: () => {},
    onTogglePlan: () => {},
    onGoalAction: async () => ({ ok: true }),
  };
}

async function mount(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    render(
      h(ChatInput, {
        value: '',
        onChange: () => {},
        onSend: () => {},
        isGenerating: false,
        composerModelRef: { current: null },
        variant: 'desktop',
        sessionId: 'composer-narrow-test',
        accessMode: 'yolo',
        onAccessModeChange: () => {},
        modes: modes(),
      }),
      host,
    );
  });
  container = host;
  return host;
}

const toolbar = (el: HTMLElement) => el.querySelector('.composer-toolbar-row') as HTMLElement;
const attachRow = (el: HTMLElement) => el.querySelector('.composer-attach-row') as HTMLElement;

describe('composer narrow mode', () => {
  test('a narrow desktop card drops the toolbar labels and moves Plan/Goal up', async () => {
    const el = await mount();
    expect(toolbar(el).textContent).toContain('Full bypass');

    await act(async () => { FakeResizeObserver.latest!.fire(360); });

    expect(toolbar(el).textContent).not.toContain('Full bypass');
    expect(toolbar(el).textContent).not.toContain('Plan');
    expect(toolbar(el).textContent).not.toContain('Goal');
    // The toggles are still offered — in the row that wraps.
    expect(attachRow(el).querySelector('[aria-label="Enter plan mode"]')).not.toBeNull();
    expect(attachRow(el).querySelector('[aria-label="Set a goal"]')).not.toBeNull();
  });

  test('a card with room keeps the desktop arrangement when it widens back', async () => {
    const el = await mount();
    await act(async () => { FakeResizeObserver.latest!.fire(360); });
    await act(async () => { FakeResizeObserver.latest!.fire(900); });

    expect(toolbar(el).textContent).toContain('Full bypass');
    expect(attachRow(el).querySelector('[aria-label="Enter plan mode"]')).toBeNull();
    const modesInToolbar = toolbar(el).querySelector('[aria-label="Enter plan mode"]');
    expect(modesInToolbar).not.toBeNull();
  });

  test('a phone composer is already narrow and never waits for a measurement', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () => {
      render(
        h(ChatInput, {
          value: '',
          onChange: () => {},
          onSend: () => {},
          isGenerating: false,
          composerModelRef: { current: null },
          variant: 'mobile',
          sessionId: 'composer-narrow-test',
          accessMode: 'yolo',
          onAccessModeChange: () => {},
          modes: modes(),
        }),
        host,
      );
    });
    container = host;
    expect(toolbar(host).textContent).not.toContain('Full bypass');
    expect(attachRow(host).querySelector('[aria-label="Enter plan mode"]')).not.toBeNull();
  });
});
