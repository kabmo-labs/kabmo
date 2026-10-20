/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test } from 'bun:test';

import {
  parseAndroidRelease,
  shouldOfferAndroidDownload,
  type AndroidDownload,
} from '@/client/hooks/ui/updates/android-download';

/**
 * The download button is a promise that a newer APK exists. These are the four
 * ways that promise can be wrong, and each must render nothing.
 */
const RELEASE: AndroidDownload = {
  url: 'https://github.com/kabmo-labs/kabmo/releases/download/v1.2.3/kabmo-android-v1.2.3.apk',
  latest: '1.2.3',
  releaseUrl: 'https://github.com/kabmo-labs/kabmo/releases/tag/v1.2.3',
};

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

describe('shouldOfferAndroidDownload', () => {
  test('offers a newer release to the app', () => {
    expect(shouldOfferAndroidDownload('1.2.2', RELEASE)).toEqual(RELEASE);
  });

  test('offers nothing to a browser', () => {
    // No shell version means the page is not the APK; a browser has no app to
    // update, and the app's own update badge already covers the server.
    expect(shouldOfferAndroidDownload(null, RELEASE)).toBeNull();
    expect(shouldOfferAndroidDownload(undefined, RELEASE)).toBeNull();
    expect(shouldOfferAndroidDownload('', RELEASE)).toBeNull();
  });

  test('offers nothing when the app is already current', () => {
    expect(shouldOfferAndroidDownload('1.2.3', RELEASE)).toBeNull();
  });

  test('offers nothing when the app is ahead', () => {
    // A sideloaded build newer than the published asset: downloading it would be
    // a downgrade.
    expect(shouldOfferAndroidDownload('1.3.0', RELEASE)).toBeNull();
  });

  test('offers nothing when the probe failed', () => {
    expect(shouldOfferAndroidDownload('1.0.0', null)).toBeNull();
  });
});
