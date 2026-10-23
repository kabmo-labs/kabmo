/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test } from 'bun:test';

import {
  parseShellRelease,
  shellDownloadLabel,
  shellFromBootstrap,
  shellReleasePath,
  shouldOfferShellDownload,
  type ShellDownload,
} from '@/client/hooks/ui/updates/shell-download';

/** The published release every case compares against. */
const RELEASE = {
  url: 'https://github.com/kabmo-labs/kabmo/releases/download/v1.2.3/Kabmo-1.2.3-android.apk',
  latest: '1.2.3',
  releaseUrl: 'https://github.com/kabmo-labs/kabmo/releases/tag/v1.2.3',
};

const UPDATE: ShellDownload = { ...RELEASE, kind: 'update', platform: 'android' };
const INSTALL: ShellDownload = { ...RELEASE, kind: 'install', platform: 'android' };

describe('parseShellRelease', () => {
  test('reads a complete payload', () => {
    expect(parseShellRelease(RELEASE)).toEqual(RELEASE);
  });

  test('refuses a payload with no artifact', () => {
    // The route answers this on a failed probe. A version without a URL would be
    // a button that downloads nothing.
    expect(parseShellRelease({ url: null, latest: '1.2.3', releaseUrl: null })).toBeNull();
    expect(parseShellRelease({ url: 'https://x/a.apk', latest: null, releaseUrl: null })).toBeNull();
  });

  test('refuses a non-object', () => {
    expect(parseShellRelease(null)).toBeNull();
    expect(parseShellRelease('nope')).toBeNull();
    expect(parseShellRelease({})).toBeNull();
  });

  test('keeps a missing releaseUrl as null', () => {
    expect(parseShellRelease({ url: 'https://x/a.apk', latest: '1.0.0' })?.releaseUrl).toBeNull();
  });
});

describe('the offer inside the installed shell', () => {
  test('offers an UPDATE when a newer build is published', () => {
    expect(shouldOfferShellDownload('android', '1.2.2', true, RELEASE)).toEqual(UPDATE);
    expect(shouldOfferShellDownload('ios', '1.2.2', null, RELEASE)).toEqual({
      ...RELEASE,
      kind: 'update',
      platform: 'ios',
    });
  });

  test('offers nothing when the shell is already current', () => {
    expect(shouldOfferShellDownload('android', '1.2.3', true, RELEASE)).toBeNull();
    expect(shouldOfferShellDownload('ios', '1.2.3', null, RELEASE)).toBeNull();
  });

  test('offers nothing when the shell is ahead', () => {
    // A sideloaded build newer than the published asset: downloading it would be
    // a downgrade.
    expect(shouldOfferShellDownload('android', '1.3.0', true, RELEASE)).toBeNull();
  });

  test('offers nothing when the probe failed', () => {
    expect(shouldOfferShellDownload('android', '1.0.0', true, null)).toBeNull();
  });
});

describe('the offer to an Android browser', () => {
  test('offers an INSTALL, because there is no installed version to compare', () => {
    // The reported gap: a reader on Chrome or Brave for Android was told
    // nothing, and the shell is exactly what they do not know exists.
    expect(shouldOfferShellDownload('android', null, true, RELEASE)).toEqual(INSTALL);
  });

  test('offers an install even when the published APK is older than some build', () => {
    // Nothing is installed here, so "newer than" has no left-hand side — the
    // published asset is simply what the button names.
    expect(shouldOfferShellDownload('android', undefined, true, { ...RELEASE, latest: '0.0.1' })).toEqual({
      ...INSTALL,
      latest: '0.0.1',
    });
  });

  test('offers nothing when no APK is published', () => {
    expect(shouldOfferShellDownload('android', null, true, null)).toBeNull();
  });

  test('an iOS browser is offered nothing, because an IPA cannot be installed there', () => {
    // iOS has no sideload-by-URL path. Offering a download to a Safari tab on an
    // iPhone would be a button that cannot do what it says.
    expect(shouldOfferShellDownload('ios', null, true, RELEASE)).toBeNull();
    expect(shouldOfferShellDownload('ios', undefined, undefined, RELEASE)).toBeNull();
  });
});

describe('everywhere else', () => {
  test('a desktop browser is offered nothing', () => {
    // An APK cannot be installed there, and the app's own update badge already
    // covers the server.
    expect(shouldOfferShellDownload('android', null, false, RELEASE)).toBeNull();
    expect(shouldOfferShellDownload('android', null, null, RELEASE)).toBeNull();
    expect(shouldOfferShellDownload('android', null, undefined, RELEASE)).toBeNull();
    expect(shouldOfferShellDownload('android', '', false, RELEASE)).toBeNull();
  });

  test('the shell token alone is enough, even if the wider flag is missing', () => {
    // `isAndroid` is derived from the same UA, so a stale bootstrap that predates
    // the field must not silently drop the update offer.
    expect(shouldOfferShellDownload('android', '1.2.2', false, RELEASE)).toEqual(UPDATE);
    expect(shouldOfferShellDownload('android', '1.2.2', undefined, RELEASE)).toEqual(UPDATE);
  });
});

describe('shellDownloadLabel', () => {
  test('names the verb the reader needs, and the platform', () => {
    expect(shellDownloadLabel(UPDATE)).toBe('Update Kabmo 1.2.3 for Android');
    expect(shellDownloadLabel(INSTALL)).toBe('Install Kabmo 1.2.3 for Android');
    expect(shellDownloadLabel({ ...UPDATE, platform: 'ios' })).toBe('Update Kabmo 1.2.3 for iOS');
  });
});

describe('shellFromBootstrap', () => {
  test('reads whichever token the request carried', () => {
    expect(shellFromBootstrap({ shellVersion: '0.5.0' })).toEqual({ platform: 'android', version: '0.5.0' });
    expect(shellFromBootstrap({ iosShellVersion: '0.1.0' })).toEqual({ platform: 'ios', version: '0.1.0' });
  });

  test('is null in a browser, and for an absent bootstrap', () => {
    expect(shellFromBootstrap({ shellVersion: null, iosShellVersion: null })).toBeNull();
    expect(shellFromBootstrap({})).toBeNull();
    expect(shellFromBootstrap(undefined)).toBeNull();
  });

  test('prefers the Android token when both are present', () => {
    // A UA carrying both is crafted rather than observed; one shell has to win,
    // and the one whose platform also has a browser offer is the safer answer.
    expect(shellFromBootstrap({ shellVersion: '0.5.0', iosShellVersion: '0.1.0' })).toEqual({
      platform: 'android',
      version: '0.5.0',
    });
  });
});

describe('shellReleasePath', () => {
  test('is one endpoint per shell', () => {
    expect(shellReleasePath('android')).toBe('/api/updates/android');
    expect(shellReleasePath('ios')).toBe('/api/updates/ios');
  });
});
