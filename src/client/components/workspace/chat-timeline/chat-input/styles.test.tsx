/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's four styles, rendered.
 *
 * The contract these pin is not cosmetic: **a style may reorder the card's rows
 * and change its frame, and may never remove a control.** The worst case of a
 * violation is the access-mode selector — the one control that decides whether
 * a turn may write to disk — silently missing from a card the user is about to
 * send from.
 *
 * The style reaches the composer through the primed settings snapshot
 * (`readKabmoSetting('composerStyle')`), which is what `main.tsx` does at boot,
 * so priming is also the honest way to mount it here.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ChatInput } from '@/client/components/workspace/chat-timeline/chat-input';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import { delay } from '@/client/hooks/chat/composer/file-reads';
import { restoreRealtime, silenceRealtime } from '@/test-support/silent-socket';
import { COMPOSER_STYLES, type ComposerStyle } from '@/shared/lib/chat/composer/style';

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
  silenceRealtime();
});

afterEach(async () => {
  // Unmount, then drain while this window still exists — see `compact.test.tsx`
  // for why the order is load-bearing (the model picker keeps a realtime
  // subscription and a reconnect timer).
  const host = container;
  if (host) {
    await act(async () => { render(null, host); });
    host.remove();
  }
  container = null;
  restoreRealtime();
  await delay(50);
});

async function mount(style: ComposerStyle): Promise<HTMLElement> {
  primeKabmoSettings({ kabmo_settings: { composerStyle: style } });
  const host = document.createElement('div');
  document.body.appendChild(host);
  container = host;

  await act(async () => {
    render(
      h(ChatInput, {
        value: '',
        onChange: () => {},
        onSend: () => {},
        isGenerating: false,
        composerModelRef: { current: null },
        variant: 'desktop',
        sessionId: 'composer-style-test',
        expandable: true,
        accessMode: 'always-ask',
        onAccessModeChange: () => {},
        modes: {
          plan: false,
          goal: false,
          goalOpen: false,
          goalRecord: null,
          goalContinuation: null,
          goalEvaluating: false,
          pending: false,
          planAvailable: true,
          error: null,
          clearError: () => {},
          onTogglePlan: () => {},
          onGoalAction: () => {},
        },
      }),
      host,
    );
  });
  await act(async () => { await delay(20); });
  return host;
}

describe('composer styles', () => {
  for (const style of COMPOSER_STYLES) {
    test(`${style} renders every control`, async () => {
      const host = await mount(style);

      // The card carries the style, so CSS can key its pixels off it.
      const card = host.querySelector('[data-composer-style]');
      expect(card?.getAttribute('data-composer-style')).toBe(style);

      // Draft.
      expect(host.querySelector('[data-testid="composer-input"]')).not.toBeNull();
      // Attach + its file input.
      expect(host.querySelector('button[title="Attach file or image"]')).not.toBeNull();
      expect(host.querySelector('input[type="file"]')).not.toBeNull();
      // The stretch control.
      expect(host.querySelector('button[aria-label="Maximize composer"]')).not.toBeNull();
      // Plan and Goal: `aria-label` carries the mode, so it survives a narrow
      // card whose labels are hidden by the container query.
      expect(host.querySelector('button[aria-label="Enter plan mode"]')).not.toBeNull();
      expect(host.querySelector('button[aria-label="Set a goal"]')).not.toBeNull();
      // Send. The VOICE button is not asserted: `useVoiceInput` reports support
      // from `navigator.mediaDevices`, which happy-dom does not implement, so its
      // absence here says nothing about a style. It is gated on capability
      // inside the toolbar, identically for every style.
      expect(host.querySelector('button[aria-label="Send message"]')).not.toBeNull();
      // The access selector is a menu, not a labelled button, so it is found by
      // its own trigger text — the value the composer was handed.
      expect(host.textContent ?? '').toContain('Always ask');
    });
  }

  test('the calm and console styles put the draft above the attachment row', async () => {
    for (const style of ['calm', 'console'] as const) {
      const host = await mount(style);
      const card = host.querySelector('[data-composer-style]');
      const children = Array.from(card?.children ?? []);
      const draftIndex = children.findIndex((el) => el.querySelector('[data-testid="composer-input"]'));
      const attachIndex = children.findIndex((el) => el.className.includes('composer-attach-row'));
      expect(draftIndex).toBeGreaterThanOrEqual(0);
      expect(attachIndex).toBeGreaterThanOrEqual(0);
      expect(draftIndex).toBeLessThan(attachIndex);

      await act(async () => { render(null, host); });
      host.remove();
      container = null;
    }
  });

  test('classic keeps the attachment row first', async () => {
    const host = await mount('classic');
    const card = host.querySelector('[data-composer-style]');
    const children = Array.from(card?.children ?? []);
    const attachIndex = children.findIndex((el) => el.className.includes('composer-attach-row'));
    const draftIndex = children.findIndex((el) => el.querySelector('[data-testid="composer-input"]'));
    expect(attachIndex).toBe(0);
    expect(attachIndex).toBeLessThan(draftIndex);
  });

  test('the console style is the only one that draws the prompt glyph', async () => {
    for (const style of COMPOSER_STYLES) {
      const host = await mount(style);
      const glyphs = Array.from(host.querySelectorAll('span[aria-hidden="true"]'))
        .filter((el) => (el.textContent ?? '').includes('omp ›'));
      expect(glyphs.length).toBe(style === 'console' ? 1 : 0);

      await act(async () => { render(null, host); });
      host.remove();
      container = null;
    }
  });
});
