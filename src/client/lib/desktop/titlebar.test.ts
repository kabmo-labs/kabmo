/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The shell's title-bar contract, evaluated against both shells and a browser.
 *
 * Two shells wrap this app, and they put their controls on OPPOSITE edges — or
 * nowhere at all. A single "inset" would have to say which edge it means at
 * every call site, and the cost of getting it wrong is a dead strip of window
 * with no control in it, which is exactly the macOS 76px bug stated in
 * `src/shared/lib/ui/titlebar.ts`.
 *
 * Three properties are load-bearing, and each fails silently:
 *
 * 1. macOS floats traffic lights over the page's LEFT edge, so the left inset is
 *    the shell's reported width and nothing is reserved on the right;
 * 2. Windows is borderless with no controls of its own — its webview is an HWND,
 *    so a host element cannot be painted over it — which is why the PAGE draws
 *    the three buttons there (`drawsWindowControls`), and why it reserves no
 *    inset on either edge;
 * 3. a BROWSER, or an older shell that injects no identity, gets the caller's
 *    own resolved padding (the PWA's Window Controls Overlay arithmetic).
 */

import { afterEach, describe, expect, test } from 'bun:test';

type Shell = {
  __kabmoCall?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  __kabmoDesktop?: Record<string, unknown>;
};

const scope = () => globalThis as unknown as { window?: Shell };

async function titlebar() {
  return import('@/client/lib/desktop/titlebar');
}

function shell(identity: Record<string, unknown> | null) {
  scope().window = identity === null
    ? { __kabmoCall: async () => null }
    : { __kabmoCall: async () => null, __kabmoDesktop: identity };
}

const MACOS = { platform: 'macos', shellVersion: '0.1.0', overlayTitlebar: true, trafficLightInset: '5rem' };
const WINDOWS = { platform: 'windows', shellVersion: '0.1.0', overlayTitlebar: true, windowControls: true };

describe('shell title-bar contract', () => {
  afterEach(() => {
    delete scope().window;
  });

  test('a browser reserves nothing for a shell it is not in', async () => {
    scope().window = {};
    const bar = await titlebar();
    expect(bar.overlayTitlebar()).toBe(false);
    expect(bar.dragRegionProps()).toEqual({});
    expect(bar.titlebarInsetLeft('1rem')).toBe('1rem');
    expect(bar.drawsWindowControls()).toBe(false);
  });

  test('macOS reserves the traffic lights on the left and draws no controls', async () => {
    shell(MACOS);
    const bar = await titlebar();
    expect(bar.dragRegionProps()).toEqual({ 'data-drag-region': '' });
    expect(bar.titlebarInsetLeft('1rem')).toBe('5rem');
    // The system owns the traffic lights: a page-drawn set would be a second one.
    expect(bar.drawsWindowControls()).toBe(false);
  });

  test('Windows reserves nothing and draws the three buttons itself', async () => {
    shell(WINDOWS);
    const bar = await titlebar();
    expect(bar.dragRegionProps()).toEqual({ 'data-drag-region': '' });
    // Nothing floats over the page on a borderless Windows window.
    expect(bar.titlebarInsetLeft('1rem')).toBe('1rem');
    expect(bar.drawsWindowControls()).toBe(true);
  });

  /** An older shell injects no identity at all; nothing may be invented. */
  test('a shell that reports no identity keeps the resolved padding', async () => {
    shell(null);
    const bar = await titlebar();
    expect(bar.overlayTitlebar()).toBe(true);
    expect(bar.titlebarInsetLeft('1rem')).toBe('1rem');
    expect(bar.drawsWindowControls()).toBe(false);
  });

  /** A shell that draws its own native bar must not mark a drag region. */
  test('overlayTitlebar false marks no drag region and no controls', async () => {
    shell({ platform: 'windows', shellVersion: '0.1.0', overlayTitlebar: false, windowControls: true });
    const bar = await titlebar();
    expect(bar.overlayTitlebar()).toBe(false);
    expect(bar.dragRegionProps()).toEqual({});
    // The native bar owns the buttons when it is visible.
    expect(bar.drawsWindowControls()).toBe(false);
  });
});
