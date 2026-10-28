/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The platform sniffing the shortcut labels depend on.
 *
 * A wrong answer here is not cosmetic: the label and the binding are derived
 * from the same predicate, so a mis-detected platform names a chord that does
 * not fire. The server case matters too — these modules are imported by both
 * bundles, and touching `navigator` unguarded would throw during SSR.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { isMacPlatform, isWindowsPlatform } from '@/shared/lib/util/platform';

const displaced = (globalThis as Record<string, unknown>).navigator;

function withPlatform(platform: string) {
  (globalThis as Record<string, unknown>).navigator = { platform };
}

afterAll(() => {
  if (displaced === undefined) delete (globalThis as Record<string, unknown>).navigator;
  else (globalThis as Record<string, unknown>).navigator = displaced;
});

describe('isMacPlatform', () => {
  test('recognises every Apple platform the app runs on', () => {
    for (const platform of ['MacIntel', 'Macintosh', 'iPhone', 'iPad', 'iPod']) {
      withPlatform(platform);
      expect(isMacPlatform()).toBe(true);
    }
  });

  test('is false elsewhere', () => {
    for (const platform of ['Win32', 'Win64', 'Linux x86_64', 'Linux armv8l']) {
      withPlatform(platform);
      expect(isMacPlatform()).toBe(false);
    }
  });

  test('reports false rather than throwing without a navigator', () => {
    // Shared modules are imported by the server bundle too.
    delete (globalThis as Record<string, unknown>).navigator;
    expect(isMacPlatform()).toBe(false);
    expect(isWindowsPlatform()).toBe(false);
  });
});

describe('isWindowsPlatform', () => {
  test('recognises the Windows spellings', () => {
    for (const platform of ['Win32', 'Win64', 'Windows']) {
      withPlatform(platform);
      expect(isWindowsPlatform()).toBe(true);
    }
  });

  test('is false on mac and Linux', () => {
    for (const platform of ['MacIntel', 'Linux x86_64']) {
      withPlatform(platform);
      expect(isWindowsPlatform()).toBe(false);
    }
  });

  test('does not match a platform that merely contains “win”', () => {
    // `Darwin` contains `win`; a substring test without the case rule would
    // report every macOS machine as Windows and pick the Ctrl+Y redo chord.
    withPlatform('Darwin');
    expect(isWindowsPlatform()).toBe(false);
  });
});

describe('mac and Windows are mutually exclusive', () => {
  beforeAll(() => {
    withPlatform('MacIntel');
  });

  test('no platform reports both', () => {
    for (const platform of ['MacIntel', 'Win32', 'Linux x86_64', 'iPhone']) {
      withPlatform(platform);
      expect(isMacPlatform() && isWindowsPlatform()).toBe(false);
    }
  });
});
