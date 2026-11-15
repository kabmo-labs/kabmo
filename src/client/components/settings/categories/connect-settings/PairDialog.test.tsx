/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pairing dialog's Copy link button.
 *
 * The bug this pins: the button called `navigator.clipboard?.writeText(...)`.
 * Kabmo is routinely opened over plain HTTP on a LAN or Tailscale address — the
 * exact setup the dialog exists for — and `navigator.clipboard` is undefined
 * outside a secure context, so the optional chain swallowed the click with no
 * copy and no feedback. The button now goes through `copyToClipboard` (which
 * falls back to `execCommand`) and reports the outcome as a toast.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { PairDialog } from '@/client/components/settings/categories/connect-settings/PairDialog';
import { getToastsSnapshot, resetToasts } from '@/client/hooks/ui/toasts';
import type { PairingCode } from '@/client/hooks/connect/use-pairing';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let win: Window;
let container: HTMLElement | null = null;

const CODE: PairingCode = {
  pairingId: 'pair-1',
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  link: 'kabmo://pair#abc',
  webLink: 'https://kabmo.example/pair#abc',
  candidates: [{ kind: 'lan', url: 'http://192.168.1.5:3000' }],
  qr: { size: 1, rows: ['1'] },
};

beforeAll(() => {
  win = new Window({ url: 'http://192.168.1.5:3000' });
  installDomGlobals(win);
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  container = null;
  document.body.replaceChildren();
  resetToasts();
  // The dialog portals to `<body>`; unmounting the host does not remove it.
  for (const node of document.querySelectorAll('[role="dialog"]')) node.remove();
});

afterAll(() => {
  restoreDomGlobals();
});

/** Mount the dialog and return its Copy link button. */
async function mountDialog(): Promise<HTMLButtonElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  container = host;
  await act(async () => {
    render(
      h(PairDialog, {
        code: CODE,
        error: null,
        busy: false,
        secondsLeft: 90,
        onClose: () => {},
        onRetry: () => {},
      }),
      host,
    );
  });
  const button = [...document.querySelectorAll('button')].find((node) => node.textContent === 'Copy link');
  if (!button) throw new Error('Copy link button not found');
  return button;
}

/** Make the page look like an insecure LAN origin: no async clipboard API. */
function removeClipboardApi(): void {
  Object.defineProperty(win, 'isSecureContext', { value: false, configurable: true });
  Object.defineProperty(win.navigator, 'clipboard', { value: undefined, configurable: true });
}

describe('PairDialog copy link', () => {
  test('copies through the execCommand fallback when the clipboard API is unavailable', async () => {
    removeClipboardApi();
    let copied = '';
    document.execCommand = ((command: string) => {
      if (command !== 'copy') return false;
      copied = document.querySelector('textarea')?.value ?? '';
      return true;
    }) as typeof document.execCommand;

    const button = await mountDialog();
    await act(async () => {
      button.click();
    });

    expect(copied).toBe(CODE.webLink);
    expect(getToastsSnapshot().map((toast) => [toast.message, toast.type])).toEqual([
      ['Pairing link copied', 'success'],
    ]);
  });

  test('reports a failure instead of silently doing nothing', async () => {
    removeClipboardApi();
    document.execCommand = (() => false) as typeof document.execCommand;

    const button = await mountDialog();
    await act(async () => {
      button.click();
    });

    const toasts = getToastsSnapshot();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.type).toBe('error');
    expect(toasts[0]?.message).toContain('Could not copy the pairing link');
  });
});
