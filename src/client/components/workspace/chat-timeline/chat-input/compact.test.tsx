/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The phone's compact composer.
 *
 * A reader scrolled back through the transcript with an empty draft gets the
 * height back — but not by shrinking the box: the textarea is REMOVED, and the
 * attachment row carries a "Type here" target that brings it back. Shrinking it
 * instead left a focusable element with no usable pixels and a sentence-long
 * placeholder clipped mid-word, and it kept the composer at a height it was
 * supposed to give away.
 *
 * These pin the three states that make that work: compact has no textarea and
 * one target, a tap on the target restores the box and focuses it, and a draft
 * (or a focused composer) never enters compact at all.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ChatInput } from '@/client/components/workspace/chat-timeline/chat-input';
import { restoreRealtime, silenceRealtime } from '@/test-support/silent-socket';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent'] as const;
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

beforeEach(() => {
  // Per case, because `restoreRealtime` clears the constructor: the composer's
  // model picker subscribes on every mount, and this origin has no listener to
  // reach, so a real dial would fail after the globals are restored.
  silenceRealtime();
});

afterEach(() => {
  container?.remove();
  container = null;
  // The composer's model picker subscribes to the realtime topic, and its
  // reconnect timer outlives this file's DOM — it then fires into a torn-down
  // `window` and surfaces as an unhandled error in whichever test runs next.
  // `restoreRealtime` resets the client AND puts the real constructor back, so
  // the silence does not follow this file into the next one.
  restoreRealtime();
});

interface MountOptions {
  shrinkWhileReading?: boolean;
  value?: string;
  variant?: 'desktop' | 'mobile';
}

async function mount({
  shrinkWhileReading = false,
  value = '',
  variant = 'mobile',
}: MountOptions = {}): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    // No `SessionStateProvider`: the composer reads no session UI state, and the
    // provider's own load kicks a realtime reconnect that outlives this file and
    // throws `window is not defined` after teardown.
    render(
      h(ChatInput, {
        value,
        onChange: () => {},
        onSend: () => {},
        isGenerating: false,
        composerModelRef: { current: null },
        variant,
        shrinkWhileReading,
        sessionId: 'composer-compact-test',
      }),
      host,
    );
  });
  container = host;
  return host;
}

const textarea = (el: HTMLElement) => el.querySelector('textarea');
const typeHere = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === 'Type here') ?? null;

describe('compact composer', () => {
  test('a scrolled-back phone with an empty draft renders no textarea at all', async () => {
    const el = await mount({ shrinkWhileReading: true });
    expect(textarea(el)).toBeNull();
  });

  test('…and offers exactly one target that says what tapping it does', async () => {
    const el = await mount({ shrinkWhileReading: true });
    const target = typeHere(el);
    expect(target).not.toBeNull();
    expect(target!.tagName).toBe('BUTTON');
  });

  test('a draft keeps the box: the reader is writing, not reading', async () => {
    const el = await mount({ shrinkWhileReading: true, value: 'half a prompt' });
    expect(textarea(el)).not.toBeNull();
    expect(typeHere(el)).toBeNull();
  });

  test('a desktop is never compact — its composer sits beside the chat', async () => {
    const el = await mount({ shrinkWhileReading: true, variant: 'desktop' });
    expect(textarea(el)).not.toBeNull();
  });

  test('tapping the target brings the textarea back, focused', async () => {
    const el = await mount({ shrinkWhileReading: true });
    const target = typeHere(el)!;
    // POINTERDOWN, not click: pressing the target expands the composer, which
    // removes the button the finger is still on — so the browser never emits a
    // click at all (measured in Chromium: `pd:BUTTON` with no `click` after it).
    await act(async () => { target.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true })); });
    const box = textarea(el);
    expect(box).not.toBeNull();
    // The tap ends where the reader aimed it: the caret is in the box, which is
    // also what stops the scroll position from collapsing it again.
    expect(document.activeElement).toBe(box);
  });

  test('tapping a control inside the compact card does not also re-open it', async () => {
    const el = await mount({ shrinkWhileReading: true });
    const paperclip = el.querySelector('button[title="Attach file or image"]') as HTMLButtonElement;
    await act(async () => { paperclip.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true })); });
    // The paperclip owns its own click; the card must not turn it into a reopen.
    expect(textarea(el)).toBeNull();
  });

  test('in the normal state, tapping the card focuses the draft instead of doing nothing', async () => {
    const el = await mount({ shrinkWhileReading: false });
    const box = textarea(el)!;
    // The header row is the line the paperclip lives on; a click on its padding
    // is a click on the composer, and the caret should land in the draft.
    const header = el.querySelector('button[title="Attach file or image"]')!.parentElement!;
    await act(async () => { header.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true })); });
    expect(document.activeElement).toBe(box);
  });
});
