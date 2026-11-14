/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The changed-files setting's read rule: on unless the stored value is the
 * literal `false`. A missing key (an install that predates the setting) and a
 * malformed value both keep the list, because the list is the only place the
 * transcript says which files a run touched.
 */

import { describe, expect, test } from 'bun:test';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import { currentShowChangedFiles } from '@/client/hooks/chat/timeline/changed-files-setting';

describe('currentShowChangedFiles', () => {
  test('defaults on, and only the literal false turns it off', () => {
    primeKabmoSettings({});
    expect(currentShowChangedFiles()).toBe(true);

    primeKabmoSettings({ showChangedFiles: false });
    expect(currentShowChangedFiles()).toBe(false);

    primeKabmoSettings({ showChangedFiles: true });
    expect(currentShowChangedFiles()).toBe(true);

    primeKabmoSettings({ showChangedFiles: 'no' });
    expect(currentShowChangedFiles()).toBe(true);
  });
});
