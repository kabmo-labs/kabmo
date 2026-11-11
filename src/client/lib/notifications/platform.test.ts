/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The device class decides which master switch a banner obeys. The distinction
 * that matters: a narrow desktop window reflows the shell but must still answer
 * to the Desktop switch, so width is deliberately not consulted.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import {
  isMobileNotificationClient,
  notificationPlatformForClient,
} from '@/client/lib/notifications/platform';

const DOM_GLOBALS = ['window', 'document', 'navigator'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

function install(userAgent: string, opts: { coarse?: boolean; hoverNone?: boolean } = {}): void {
  const win = new Window({ url: 'http://localhost' });
  Object.defineProperty(win.navigator, 'userAgent', { configurable: true, value: userAgent });
  win.matchMedia = ((query: string) => ({
    matches: (query === '(pointer: coarse)' && opts.coarse === true)
      || (query === '(hover: none)' && opts.hoverNone === true),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof win.matchMedia;
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
}

beforeEach(() => {
  install('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
});

afterEach(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) target[key] = nativeGlobals[key];
});

describe('isMobileNotificationClient', () => {
  test('a desktop browser is desktop, whatever its window width', () => {
    expect(isMobileNotificationClient()).toBe(false);
    expect(notificationPlatformForClient()).toBe('desktop');
  });

  test('a phone user agent is mobile', () => {
    install('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148');
    expect(isMobileNotificationClient()).toBe(true);
  });

  test('a coarse primary pointer is mobile even with a desktop user agent', () => {
    install('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', { coarse: true, hoverNone: true });
    expect(notificationPlatformForClient()).toBe('mobile');
  });
});
