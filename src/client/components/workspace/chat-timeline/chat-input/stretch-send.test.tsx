/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A DISPATCHED send returns the composer to its docked size, on BOTH layouts.
 *
 * This is the rule the click handler used to own as `if (isMobile)
 * setExpanded(false)`, which was wrong twice over. A desktop kept its 38vh box
 * over the conversation the prompt was written against, and on EITHER layout a
 * press that dispatched nothing (an empty draft, an attachment whose read
 * produced no body) collapsed a box whose content had never been sent — a
 * refusal that read as success.
 *
 * The collapse therefore lives in the send pipeline's `onSent`, after every
 * guard. These cases pin both directions from the component the user actually
 * presses: the Maximize control, then a send, then the frame it is in.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import type { Attachment } from '@/shared/types';
import { ChatInput } from '@/client/components/workspace/chat-timeline/chat-input';
import { delay } from '@/client/hooks/chat/composer/file-reads';
import { restoreRealtime, silenceRealtime } from '@/test-support/silent-socket';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'PointerEvent'] as const;
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
/** Every dispatch the composer made, so a case can assert what was NOT sent. */
const sent: Attachment[][] = [];

beforeEach(() => {
  silenceRealtime();
  sent.length = 0;
});

afterEach(async () => {
  // Unmount inside `act`, then drain AFTER the realtime reset and WHILE this
  // window still exists. A stretched composer runs `useKeyboardInset` — a
  // `ResizeObserver`, four window listeners and a deferred
  // `requestAnimationFrame` — and the send pipeline resolves on a zero-delay
  // read-back, so a case can leave work queued on this window; Preact's own
  // effect flush is deferred too, so an unmount outside `act` lets a render land
  // after `afterAll` deletes the globals. Measured as `document is not defined`
  // inside whichever file bun runs next: 9 of 12 folder runs without this
  // drain, 0 of 10 with it. The drain must be a BARE timer — wrapping it in
  // `act` queues another flush and reintroduces the leak.
  const host = container;
  if (host) {
    // The local binding is the narrowing: a closure cannot carry it.
    await act(async () => { render(null, host); });
    host.remove();
  }
  container = null;
  restoreRealtime();
  await delay(50);
});


interface MountOptions {
  value?: string;
  variant?: 'desktop' | 'mobile';
}

async function mount({ value = '', variant = 'desktop' }: MountOptions = {}): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    render(
      h(ChatInput, {
        value,
        onChange: () => {},
        onSend: (attachments: Attachment[]) => { sent.push(attachments); },
        isGenerating: false,
        composerModelRef: { current: null },
        variant,
        expandable: true,
        sessionId: 'composer-stretch-test',
      }),
      host,
    );
  });
  container = host;
  return host;
}

const byLabel = (el: HTMLElement, label: string) =>
  el.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null;
const isExpanded = (el: HTMLElement) => byLabel(el, 'Restore composer') !== null;

/** Clicks the Maximize control, the way the user starts a stretched draft. */
async function stretch(el: HTMLElement) {
  const maximize = byLabel(el, 'Maximize composer');
  expect(maximize).not.toBeNull();
  await act(async () => { maximize!.click(); });
  expect(isExpanded(el)).toBe(true);
}

/** Drains the pipeline's own zero-delay wait plus the renders it lands. */
async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => { await delay(0); });
  }
}

describe('a send collapses the stretch', () => {
  for (const variant of ['desktop', 'mobile'] as const) {
    test(`a ${variant} send returns the composer to the dock`, async () => {
      const el = await mount({ value: 'collapse me', variant });
      await stretch(el);

      const send = byLabel(el, 'Send message');
      expect(send).not.toBeNull();
      await act(async () => { send!.click(); });
      await settle();

      expect(sent.length).toBe(1);
      // Back to the docked frame: the control offers Maximize again.
      expect(isExpanded(el)).toBe(false);
    });
  }

  test('a send that dispatched nothing leaves the stretched box alone', async () => {
    const el = await mount({ variant: 'desktop' });
    await stretch(el);

    // Enter with an empty draft: the pipeline returns before it dispatches, so
    // the box the user stretched stays exactly as they left it.
    const textarea = el.querySelector('textarea')!;
    await act(async () => {
      textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await settle();

    expect(sent).toEqual([]);
    expect(isExpanded(el)).toBe(true);

    // Collapse before teardown: a stretched composer keeps `useKeyboardInset`
    // live (a `ResizeObserver` plus a deferred frame), and leaving one mounted
    // past `afterAll` lets its work run after the DOM globals are gone.
    await act(async () => { byLabel(el, 'Restore composer')!.click(); });
  });
});
