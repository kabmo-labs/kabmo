/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test } from 'bun:test';

import {
  androidDownloadLabel,
  parseAndroidRelease,
  shouldOfferAndroidDownload,
  type AndroidDownload,
} from '@/client/hooks/ui/updates/android-download';

/** The published release every case compares against. */
const RELEASE = {
  url: 'https://github.com/kabmo-labs/kabmo/releases/download/v1.2.3/kabmo-android-v1.2.3.apk',
  latest: '1.2.3',
  releaseUrl: 'https://github.com/kabmo-labs/kabmo/releases/tag/v1.2.3',
};

const UPDATE: AndroidDownload = { ...RELEASE, kind: 'update' };
const INSTALL: AndroidDownload = { ...RELEASE, kind: 'install' };

describe('parseAndroidRelease', () => {
  test('reads a complete payload', () => {
    expect(parseAndroidRelease(RELEASE)).toEqual(RELEASE);
  });

  test('refuses a payload with no asset', () => {
    // The route answers this on a failed probe. A version without a URL would be
    // a button that downloads nothing.
    expect(parseAndroidRelease({ url: null, latest: '1.2.3', releaseUrl: null })).toBeNull();
    expect(parseAndroidRelease({ url: 'https://x/a.apk', latest: null, releaseUrl: null })).toBeNull();
  });

  test('refuses a non-object', () => {
    expect(parseAndroidRelease(null)).toBeNull();
    expect(parseAndroidRelease('nope')).toBeNull();
    expect(parseAndroidRelease({})).toBeNull();
  });

  test('keeps a missing releaseUrl as null', () => {
    expect(parseAndroidRelease({ url: 'https://x/a.apk', latest: '1.0.0' })?.releaseUrl).toBeNull();
  });
});

describe('the offer inside the installed app', () => {
  test('offers an UPDATE when a newer APK is published', () => {
    expect(shouldOfferAndroidDownload('1.2.2', true, RELEASE)).toEqual(UPDATE);
  });

  test('offers nothing when the app is already current', () => {
    expect(shouldOfferAndroidDownload('1.2.3', true, RELEASE)).toBeNull();
  });

  test('offers nothing when the app is ahead', () => {
    // A sideloaded build newer than the published asset: downloading it would be
    // a downgrade.
    expect(shouldOfferAndroidDownload('1.3.0', true, RELEASE)).toBeNull();
  });

  test('offers nothing when the probe failed', () => {
    expect(shouldOfferAndroidDownload('1.0.0', true, null)).toBeNull();
  });
});

describe('the offer to an Android browser', () => {
  test('offers an INSTALL, because there is no installed version to compare', () => {
    // The reported gap: a reader on Chrome or Brave for Android was told
    // nothing, and the shell is exactly what they do not know exists.
    expect(shouldOfferAndroidDownload(null, true, RELEASE)).toEqual(INSTALL);
  });

  test('offers an install even when the published APK is older than some build', () => {
    // Nothing is installed here, so "newer than" has no left-hand side — the
    // published asset is simply what the button names.
    expect(shouldOfferAndroidDownload(undefined, true, { ...RELEASE, latest: '0.0.1' })).toEqual({
      ...INSTALL,
      latest: '0.0.1',
    });
  });

  test('offers nothing when no APK is published', () => {
    expect(shouldOfferAndroidDownload(null, true, null)).toBeNull();
  });
});

describe('everywhere else', () => {
  test('a desktop browser is offered nothing', () => {
    // An APK cannot be installed there, and the app's own update badge already
    // covers the server.
    expect(shouldOfferAndroidDownload(null, false, RELEASE)).toBeNull();
    expect(shouldOfferAndroidDownload(null, null, RELEASE)).toBeNull();
    expect(shouldOfferAndroidDownload(null, undefined, RELEASE)).toBeNull();
    expect(shouldOfferAndroidDownload('', false, RELEASE)).toBeNull();
  });

  test('the shell token alone is enough, even if the wider flag is missing', () => {
    // `isAndroid` is derived from the same UA, so a stale bootstrap that predates
    // the field must not silently drop the update offer.
    expect(shouldOfferAndroidDownload('1.2.2', false, RELEASE)).toEqual(UPDATE);
    expect(shouldOfferAndroidDownload('1.2.2', undefined, RELEASE)).toEqual(UPDATE);
  });
});

describe('androidDownloadLabel', () => {
  test('names the verb the reader needs', () => {
    expect(androidDownloadLabel(UPDATE)).toBe('Update Kabmo 1.2.3 for Android');
    expect(androidDownloadLabel(INSTALL)).toBe('Install Kabmo 1.2.3 for Android');
  });
});
