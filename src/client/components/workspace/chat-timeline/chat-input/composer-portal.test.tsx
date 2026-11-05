/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Nothing the composer mounts may be a `fixed` overlay INSIDE its card.
 *
 * The composer card can become a containing block for `position: fixed` through
 * any of `backdrop-filter` (its own `glass` style), a `transform`, or
 * `contain: layout`. Measured in Chromium at 1440x900 by re-parenting the Goal
 * dialog's scrim into `[data-composer-style]`: it went from `1440x900` at
 * `(0,0)` to `710x164` at the card's box, i.e. the dialog centred on the
 * composer instead of the screen.
 *
 * The rule that follows, and what this file guards: a composer-mounted dialog
 * PORTALS to `<body>`. `ChatInput` is mounted for real here (all five styles),
 * the Goal modal is opened through the same button the operator presses, and
 * the assertion is about the TREE — the scrim must not be a descendant of the
 * card, whatever the browser later does with layout.
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
  const host = container;
  if (host) {
    await act(async () => { render(null, host); });
    host.remove();
  }
  container = null;
  restoreRealtime();
  await delay(50);
  // Any dialog a case left open must not outlive it: the portal is outside the
  // mount host, so unmounting the host is not enough.
  for (const node of document.querySelectorAll('.modal-scrim')) node.remove();
});

/** Mount the composer with its Goal modal reachable, as the operator sees it. */
async function mountComposer(style: ComposerStyle): Promise<HTMLElement> {
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
        sessionId: 'composer-portal-test',
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
          goalArm: null,
          disarmGoal: () => {},
          pending: false,
          planAvailable: true,
          error: null,
          clearError: () => {},
          onTogglePlan: () => {},
          onGoalAction: async () => ({ ok: true }),
        },
      }),
      host,
    );
  });
  await act(async () => { await delay(20); });
  return host;
}

/** Open the Goal modal through the toolbar button, the real entry point. */
async function openGoalModal(host: HTMLElement): Promise<void> {
  const button = host.querySelector('[aria-label="Set a goal"]') as HTMLButtonElement | null;
  if (!button) throw new Error('no Goal button on the composer');
  await act(async () => { button.click(); });
  await act(async () => { await delay(20); });
}

describe('a composer-mounted dialog', () => {
  for (const style of COMPOSER_STYLES) {
    test(`${style}: the goal dialog lives in <body>, not in the composer card`, async () => {
      const host = await mountComposer(style);
      await openGoalModal(host);

      const card = host.querySelector('[data-composer-style]') as HTMLElement;
      const scrim = document.body.querySelector('.glass-overlay')?.parentElement as HTMLElement | null;

      expect(scrim).not.toBeNull();
      // The tree assertion. If this fails, the browser will size `inset-0`
      // against whichever containing block the style happens to create, and the
      // dialog centres on the composer — the bug this file exists for.
      expect(card.contains(scrim)).toBe(false);
      expect(scrim?.parentElement).toBe(document.body);
      expect(scrim?.className).toContain('fixed');
      expect(scrim?.className).toContain('inset-0');
    });
  }

  test('no `fixed` overlay survives INSIDE the composer card', async () => {
    // The generic form of the rule, so a future dialog added to the composer
    // fails here instead of shipping: any descendant of the card that declares
    // `position: fixed` would be sized by the card, not the viewport.
    const host = await mountComposer('glass');
    await openGoalModal(host);

    const card = host.querySelector('[data-composer-style]') as HTMLElement;
    // The class is the source of truth here: Tailwind's `fixed` is what SETS the
    // property, and reading the computed value in this DOM would only re-ask
    // the same question through a stylesheet that the test window does not load.
    const offenders = [...card.querySelectorAll('*')].filter((node) =>
      /(^|\s)fixed(\s|$)/.test((node as Element).className || ''),
    );
    expect(offenders.map((node) => node.className)).toEqual([]);
  });

  test('closing it removes the portal, leaving nothing in <body>', async () => {
    const host = await mountComposer('classic');
    await openGoalModal(host);
    expect(document.body.querySelector('.glass-overlay')).not.toBeNull();

    const cancel = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === 'Cancel');
    expect(cancel).toBeDefined();
    await act(async () => { (cancel as HTMLButtonElement).click(); });
    await act(async () => { await delay(20); });

    expect(document.body.querySelector('.glass-overlay')).toBeNull();
  });
});
