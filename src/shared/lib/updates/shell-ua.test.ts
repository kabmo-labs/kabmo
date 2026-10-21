/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test } from 'bun:test';

import { androidShellVersion, isAndroidDevice, SHELL_UA_PREFIX } from '@/shared/lib/updates/shell-ua';

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

/**
 * The wider fact, and the one the INSTALL offer rests on: a reader on Chrome or
 * Brave for Android carries no shell token, so "not the app" alone cannot tell
 * them from a desktop where an APK is useless.
 *
 * The two failure modes are a device wrongly included (a button offering an
 * install to a machine that cannot install it) and a real Android device wrongly
 * excluded (the offer never appears where it was the point).
 */
describe('isAndroidDevice', () => {
  test('recognises the real Android browsers', () => {
    // The three the report names, plus Firefox — the platform token is the same.
    expect(
      isAndroidDevice(
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe(true);
    expect(
      isAndroidDevice(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 Brave/124',
      ),
    ).toBe(true);
    expect(isAndroidDevice('Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0')).toBe(true);
  });

  test('recognises the shell itself, which also sends the platform token', () => {
    expect(
      isAndroidDevice(
        `Mozilla/5.0 (Linux; Android 15; Pixel 6 Build/AP4A; wv) AppleWebKit/537.36 (KHTML, like Gecko) `
        + `Version/4.0 Chrome/124.0.6367.219 Mobile Safari/537.36 ${SHELL_UA_PREFIX}0.3.0`,
      ),
    ).toBe(true);
  });

  test('recognises an Android tablet, which sends no Mobile token', () => {
    // The reason this matches `Android` and not `Mobile`: a tablet is a device
    // the APK installs on, and it is the case a `Mobile` test would drop.
    expect(
      isAndroidDevice(
        'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      ),
    ).toBe(true);
  });

  test('excludes every platform the APK cannot install on', () => {
    expect(isAndroidDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36')).toBe(false);
    expect(isAndroidDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36')).toBe(false);
    expect(isAndroidDevice('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36')).toBe(false);
    // An iPad sends `Mobile` and has no APK to install — the token this
    // deliberately does NOT match.
    expect(isAndroidDevice('Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1')).toBe(false);
    expect(isAndroidDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')).toBe(false);
  });

  test('is false for an empty or missing UA', () => {
    expect(isAndroidDevice('')).toBe(false);
    expect(isAndroidDevice(null)).toBe(false);
    expect(isAndroidDevice(undefined)).toBe(false);
  });

  test('does not match a lookalike word', () => {
    // `` is what stops a crafted or unrelated token from counting.
    expect(isAndroidDevice('Mozilla/5.0 (compatible; NotAndroidBot/1.0)')).toBe(false);
    expect(isAndroidDevice('Mozilla/5.0 AndroidX/1.0')).toBe(false);
  });
});
