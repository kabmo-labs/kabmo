/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pairing dialog's two outbound controls.
 *
 * The Copy link cases pin the bug where the button called
 * `navigator.clipboard?.writeText(...)`. Kabmo is routinely opened over plain
 * HTTP on a LAN or Tailscale address — the exact setup the dialog exists for —
 * and `navigator.clipboard` is undefined outside a secure context, so the
 * optional chain swallowed the click with no copy and no feedback. The button now
 * goes through `copyToClipboard` (which falls back to `execCommand`) and reports
 * the outcome as a toast.
 *
 * The Download case pins the SECOND bug: the control used to build a Blob and
 * click an anchor the page created itself. A native shell cannot download a
 * `blob:` URL — Android's download listener ignores it, and the desktop shells
 * never see a navigation — so the button did nothing there while the file it
 * produced in a browser was an SVG most viewers refuse to open. It is now a real
 * link to the server's PNG, which is the one shape every host can download.
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
  qrUrl: '/api/connect/pair/qr.png?pairingId=pair-1',
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

/** Mount the dialog. */
async function mountDialog(secondsLeft = 90): Promise<void> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  container = host;
  await act(async () => {
    render(
      h(PairDialog, {
        code: CODE,
        error: null,
        busy: false,
        secondsLeft,
        onClose: () => {},
        onRetry: () => {},
      }),
      host,
    );
  });
}

/** The control whose visible label is `label`. */
function control(label: string): HTMLElement {
  const node = [...document.querySelectorAll<HTMLElement>('button, a')].find(
    (candidate) => candidate.textContent === label,
  );
  if (!node) throw new Error(`${label} control not found`);
  return node;
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

    await mountDialog();
    await act(async () => {
      control('Copy link').click();
    });

    expect(copied).toBe(CODE.webLink);
    expect(getToastsSnapshot().map((toast) => [toast.message, toast.type])).toEqual([
      ['Pairing link copied', 'success'],
    ]);
  });

  test('reports a failure instead of silently doing nothing', async () => {
    removeClipboardApi();
    document.execCommand = (() => false) as typeof document.execCommand;

    await mountDialog();
    await act(async () => {
      control('Copy link').click();
    });

    const toasts = getToastsSnapshot();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.type).toBe('error');
    expect(toasts[0]?.message).toContain('Could not copy the pairing link');
  });
});

describe('PairDialog download QR', () => {
  test('is a link to the server PNG, not a Blob the page builds', async () => {
    await mountDialog();
    const link = control('Download QR');
    expect(link.tagName).toBe('A');
    const anchor = link as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe(CODE.qrUrl);
    expect(anchor.getAttribute('download')).toBe('kabmo-pairing-qr.png');
    // An SVG was the first attempt, and viewers rejected it.
    expect(anchor.getAttribute('href')).not.toContain('.svg');
  });

  test('an expired code offers no download, because the server would save its refusal', async () => {
    await mountDialog(0);
    const labels = [...document.querySelectorAll<HTMLElement>('button, a')].map((node) => node.textContent);
    expect(labels).not.toContain('Download QR');
    // The link stays available for a different reason: it is a copy, not a file.
    expect(labels).toContain('Copy link');
  });
});
