/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test } from 'bun:test';

import { androidShellVersion, SHELL_UA_PREFIX } from '@/shared/lib/updates/shell-ua';

/**
 * The token is the only signal that a page is running inside the Android app,
 * and it decides whether a download button appears. Two failure modes matter:
 * a browser mistaken for the app (a button in a place it does not belong) and a
 * malformed token read as a version (a comparison against `''`).
 */
describe('androidShellVersion', () => {
  test('reads the version from a real WebView UA', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 15; Pixel 6 Build/AP4A; wv) AppleWebKit/537.36 (KHTML, like Gecko) '
      + `Version/4.0 Chrome/124.0.6367.219 Mobile Safari/537.36 ${SHELL_UA_PREFIX}0.1.0`;
    expect(androidShellVersion(ua)).toBe('0.1.0');
  });

  test('is null for a plain browser', () => {
    expect(androidShellVersion('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/124.0 Safari/537.36')).toBeNull();
    expect(androidShellVersion('')).toBeNull();
    expect(androidShellVersion(null)).toBeNull();
    expect(androidShellVersion(undefined)).toBeNull();
  });

  test('is null when the token carries no usable version', () => {
    // A forged or truncated token must not read as version '' — that would make
    // `isNewer(latest, '')` true for every release and show a button always.
    expect(androidShellVersion('Mozilla/5.0 KabmoAndroid/')).toBeNull();
    expect(androidShellVersion('Mozilla/5.0 KabmoAndroid/abc')).toBeNull();
    expect(androidShellVersion('Mozilla/5.0 KabmoAndroid/1.x.3')).toBeNull();
  });

  test('accepts one-, two- and three-part versions and a prerelease', () => {
    expect(androidShellVersion('KabmoAndroid/1')).toBe('1');
    expect(androidShellVersion('KabmoAndroid/1.2')).toBe('1.2');
    expect(androidShellVersion('KabmoAndroid/1.2.3')).toBe('1.2.3');
    expect(androidShellVersion('KabmoAndroid/1.2.3-beta.1')).toBe('1.2.3-beta.1');
  });

  test('takes the first token when the UA was crafted twice', () => {
    expect(androidShellVersion('KabmoAndroid/1.0.0 KabmoAndroid/9.9.9')).toBe('1.0.0');
  });

  test('does not match a lookalike token', () => {
    expect(androidShellVersion('KabmoAndroidX/1.0.0')).toBeNull();
    expect(androidShellVersion('Mozilla KabmoAndroid')).toBeNull();
  });
});
