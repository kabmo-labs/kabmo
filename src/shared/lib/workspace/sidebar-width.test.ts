/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The sidebar width is GLOBAL, and the migration that made it so.
 *
 * The sidebar lists the same sessions in every chat and only the highlight
 * moves, so a width stored per session moved the panel whenever the user picked
 * a different chat. It lives in `app_settings.omp_sidebar_width` now, and this
 * pins the PRECEDENCE the upgrade resolves with — the stored setting, else the
 * retired GLOBAL `desktopLayoutSizes.left`, else the open session's slot.
 *
 * That order is the whole point: 120 sessions on a real install carry the same
 * seeded `left` while a handful carry a local drag, so adopting a session slot
 * first would move the sidebar 351 → 500 on the first switch — the exact
 * symptom the global slot exists to end.
 *
 * Split from `workspace-modules.test.ts`, which is at the file-size ceiling.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test';

import { primeKabmoSettings, readKabmoSetting, writeSetting } from '@/shared/lib/settings/client';
import {
  DEFAULT_LEFT_PANEL_WIDTH,
  MAX_LEFT_PANEL_WIDTH,
  MIN_LEFT_PANEL_WIDTH,
  resolveSidebarWidth,
  saveSidebarWidth,
} from '@/shared/lib/workspace/sidebar-width';

const WIDTH_KEY = 'omp_sidebar_width';
const LEGACY_KEY = 'desktopLayoutSizes';

/** Every case starts from "nothing stored", which is what a real upgrade sees. */
function resetSettings(): void {
  primeKabmoSettings({});
}

afterEach(() => {
  resetSettings();
});

afterAll(() => {
  // The settings snapshot is module state shared by every suite in one
  // `bun test` process; leave it as close to how it was found as possible.
  primeKabmoSettings({});
});

describe('sidebar-width', () => {
  test('the default opens the panel at 280', () => {
    resetSettings();
    expect(DEFAULT_LEFT_PANEL_WIDTH).toBe(280);
    expect(resolveSidebarWidth()).toBe(DEFAULT_LEFT_PANEL_WIDTH);
  });

  test('the retired GLOBAL blob is adopted, and pinned for later sessions', () => {
    resetSettings();
    writeSetting(LEGACY_KEY, { left: 342, editor: { px: 320 } });

    expect(resolveSidebarWidth(500)).toBe(342);
    // Pinned: the next session reads the setting, never its own slot again.
    expect(readKabmoSetting<number>(WIDTH_KEY)).toBe(342);
    expect(resolveSidebarWidth(500)).toBe(342);
  });

  test('a session slot is adopted only when no global value exists at all', () => {
    resetSettings();
    expect(resolveSidebarWidth(348)).toBe(348);
    expect(readKabmoSetting<number>(WIDTH_KEY)).toBe(348);
  });

  test('a stored width beats both retired sources', () => {
    resetSettings();
    writeSetting(WIDTH_KEY, 400);
    writeSetting(LEGACY_KEY, { left: 342 });
    expect(resolveSidebarWidth(500)).toBe(400);
  });

  test('every source is clamped to the separator range', () => {
    resetSettings();
    writeSetting(LEGACY_KEY, { left: 5000 });
    expect(resolveSidebarWidth()).toBe(MAX_LEFT_PANEL_WIDTH);

    resetSettings();
    expect(resolveSidebarWidth(10)).toBe(MIN_LEFT_PANEL_WIDTH);

    resetSettings();
    writeSetting(WIDTH_KEY, 900);
    expect(resolveSidebarWidth()).toBe(MAX_LEFT_PANEL_WIDTH);
  });

  test('a malformed source is skipped rather than rendered', () => {
    resetSettings();
    writeSetting(LEGACY_KEY, { left: 'wide' });
    expect(resolveSidebarWidth('narrow')).toBe(DEFAULT_LEFT_PANEL_WIDTH);

    resetSettings();
    writeSetting(LEGACY_KEY, 'not-an-object');
    expect(resolveSidebarWidth(Number.NaN)).toBe(DEFAULT_LEFT_PANEL_WIDTH);
  });

  test('a save clamps and round-trips', () => {
    resetSettings();
    saveSidebarWidth(333.6);
    expect(readKabmoSetting<number>(WIDTH_KEY)).toBe(334);
    expect(resolveSidebarWidth()).toBe(334);
  });
});
