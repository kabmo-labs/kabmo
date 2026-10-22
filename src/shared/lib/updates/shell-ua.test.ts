/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test } from 'bun:test';

import { isAndroidDevice, shellVersion, SHELL_UA_PREFIXES } from '@/shared/lib/updates/shell-ua';

/**
 * The token is the only signal that a page is running inside a native shell, and
 * it decides whether a download button appears. Two failure modes matter: a
 * browser mistaken for the shell (a button in a place it does not belong) and a
 * malformed token read as a version (a comparison against `''`).
 *
 * Both shells are exercised against the same parser, because the grammar is one
 * grammar and only the prefix differs — the shape that silently reads the other
 * shell's version.
 */
describe('shellVersion', () => {
  test('reads the version from a real Android WebView UA', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 15; Pixel 6 Build/AP4A; wv) AppleWebKit/537.36 (KHTML, like Gecko) '
      + `Version/4.0 Chrome/124.0.6367.219 Mobile Safari/537.36 ${SHELL_UA_PREFIXES.android}0.1.0`;
    expect(shellVersion(ua, 'android')).toBe('0.1.0');
    expect(shellVersion(ua, 'ios')).toBeNull();
  });

  test('reads the version from a real iOS WKWebView UA', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) '
      + `Mobile/15E148 ${SHELL_UA_PREFIXES.ios}0.1.0`;
    expect(shellVersion(ua, 'ios')).toBe('0.1.0');
    // The platform token is `iPhone`, not `Android` — so the Android install
    // offer must not fire for the iOS shell.
    expect(isAndroidDevice(ua)).toBe(false);
  });

  test('is null for a plain browser', () => {
    const browser = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
    expect(shellVersion(browser, 'android')).toBeNull();
    expect(shellVersion(browser, 'ios')).toBeNull();
    expect(shellVersion('', 'android')).toBeNull();
    expect(shellVersion(null, 'android')).toBeNull();
    expect(shellVersion(undefined, 'ios')).toBeNull();
  });

  test('is null when the token carries no usable version', () => {
    // A forged or truncated token must not read as version '' — that would make
    // `isNewer(latest, '')` true for every release and show a button always.
    expect(shellVersion('Mozilla/5.0 KabmoAndroid/', 'android')).toBeNull();
    expect(shellVersion('Mozilla/5.0 KabmoAndroid/abc', 'android')).toBeNull();
    expect(shellVersion('Mozilla/5.0 KabmoAndroid/1.x.3', 'android')).toBeNull();
    expect(shellVersion('Mozilla/5.0 KabmoIOS/', 'ios')).toBeNull();
    expect(shellVersion('Mozilla/5.0 KabmoIOS/1.x.3', 'ios')).toBeNull();
  });

  test('accepts one-, two- and three-part versions and a prerelease', () => {
    for (const prefix of Object.values(SHELL_UA_PREFIXES)) {
      const kind = prefix === SHELL_UA_PREFIXES.android ? 'android' : 'ios';
      expect(shellVersion(`${prefix}1`, kind)).toBe('1');
      expect(shellVersion(`${prefix}1.2`, kind)).toBe('1.2');
      expect(shellVersion(`${prefix}1.2.3`, kind)).toBe('1.2.3');
      expect(shellVersion(`${prefix}1.2.3-beta.1`, kind)).toBe('1.2.3-beta.1');
    }
  });

  test('takes the first token when the UA was crafted twice', () => {
    expect(shellVersion('KabmoAndroid/1.0.0 KabmoAndroid/9.9.9', 'android')).toBe('1.0.0');
    expect(shellVersion('KabmoIOS/1.0.0 KabmoIOS/9.9.9', 'ios')).toBe('1.0.0');
  });

  test('does not match a lookalike token', () => {
    expect(shellVersion('KabmoAndroidX/1.0.0', 'android')).toBeNull();
    expect(shellVersion('Mozilla KabmoAndroid', 'android')).toBeNull();
    expect(shellVersion('KabmoIOSX/1.0.0', 'ios')).toBeNull();
    expect(shellVersion('Mozilla KabmoIOS', 'ios')).toBeNull();
  });

  test('the two prefixes are distinct', () => {
    // A shared prefix would make one shell's token readable as the other's, and
    // the two artifacts are on separate release tracks.
    expect(SHELL_UA_PREFIXES.android).not.toBe(SHELL_UA_PREFIXES.ios);
    expect(SHELL_UA_PREFIXES.android.startsWith(SHELL_UA_PREFIXES.ios)).toBe(false);
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
        + `Version/4.0 Chrome/124.0.6367.219 Mobile Safari/537.36 ${SHELL_UA_PREFIXES.android}0.3.0`,
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
    // `` is what stops a crafted or unrelated token from counting.
    expect(isAndroidDevice('Mozilla/5.0 (compatible; NotAndroidBot/1.0)')).toBe(false);
    expect(isAndroidDevice('Mozilla/5.0 AndroidX/1.0')).toBe(false);
  });
});
