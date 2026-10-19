/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The once-per-version announcement latch.
 *
 * The popup must appear exactly once per version, so the tests pin the three
 * states that matter: no marker (first run → announce), a marker for another
 * version (a newer release arrived → announce), and the same version (→ do not
 * announce). `readAnnouncedVersion` has to treat a blank or non-string stored
 * value as "never announced" rather than crashing, and `markAnnounced` must be
 * readable back immediately — it is called when the popup is actually shown, so
 * a write that does not reach the in-memory snapshot would re-announce the same
 * version on the next read within the same session.
 *
 * The settings snapshot is primed per test; `markAnnounced` also POSTs through
 * the shared settings client, whose fire-and-forget failure is irrelevant here.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import {
  UPDATE_POPUP_OPEN_EVENT,
  UPDATE_POPUP_SETTING_KEY,
  UPDATE_REQUEST_EVENT,
  markAnnounced,
  readAnnouncedVersion,
  shouldAnnounce,
} from '@/shared/lib/updates/popup-state';
import { primeKabmoSettings } from '@/shared/lib/settings/client';

describe('popup-state constants', () => {
  test('names the settings key and the two window events', () => {
    expect(UPDATE_POPUP_SETTING_KEY).toBe('omp_update_popup_version');
    expect(UPDATE_POPUP_OPEN_EVENT).toBe('omp:update-popup');
    expect(UPDATE_REQUEST_EVENT).toBe('omp:update-request');
  });
});

describe('readAnnouncedVersion', () => {
  beforeEach(() => {
    primeKabmoSettings({});
  });

  test('is null when nothing was ever announced', () => {
    expect(readAnnouncedVersion()).toBeNull();
  });

  test('returns a stored version, trimmed', () => {
    primeKabmoSettings({ [UPDATE_POPUP_SETTING_KEY]: '  3.8.0  ' });
    expect(readAnnouncedVersion()).toBe('3.8.0');
  });

  test('treats a blank or non-string marker as never announced', () => {
    primeKabmoSettings({ [UPDATE_POPUP_SETTING_KEY]: '' });
    expect(readAnnouncedVersion()).toBeNull();
    primeKabmoSettings({ [UPDATE_POPUP_SETTING_KEY]: '   ' });
    expect(readAnnouncedVersion()).toBeNull();
    primeKabmoSettings({ [UPDATE_POPUP_SETTING_KEY]: 42 });
    expect(readAnnouncedVersion()).toBeNull();
  });
});

describe('shouldAnnounce', () => {
  test('announces an unseen version and stays quiet on the seen one', () => {
    expect(shouldAnnounce('3.8.0', null)).toBe(true);
    expect(shouldAnnounce('3.8.0', '3.8.0')).toBe(false);
    expect(shouldAnnounce('3.9.0', '3.8.0')).toBe(true);
  });

  test('never announces without a version to name', () => {
    expect(shouldAnnounce(null, null)).toBe(false);
    expect(shouldAnnounce(null, '3.8.0')).toBe(false);
    expect(shouldAnnounce('', '3.8.0')).toBe(false);
  });

  test('defaults the marker to the stored setting', () => {
    primeKabmoSettings({ [UPDATE_POPUP_SETTING_KEY]: '3.8.0' });
    expect(shouldAnnounce('3.8.0')).toBe(false);
    expect(shouldAnnounce('3.9.0')).toBe(true);
  });
});

describe('markAnnounced', () => {
  test('records the version so the next read sees it', () => {
    primeKabmoSettings({});
    markAnnounced('3.9.0');
    expect(readAnnouncedVersion()).toBe('3.9.0');
    expect(shouldAnnounce('3.9.0')).toBe(false);
  });
});

/** The snapshot is module state shared across the whole `bun test` process. */
afterAll(() => {
  primeKabmoSettings({});
});
