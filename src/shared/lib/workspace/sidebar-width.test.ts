/**
 * @license
 * SPDX-License-Identifier: MIT
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
  sidebarWidthForViewport,
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

describe('the width a narrow WINDOW may give the column', () => {
  /**
   * A width dragged on a 1440px display is still 414px on a 768px window, where
   * it took 54% of the screen and left the chat 148px with a 116px composer
   * (measured on the running console). The cap is a share of the viewport, and
   * it is applied to the RENDERED width so the chosen one comes back on a wider
   * window.
   */
  test('a wide window keeps the stored width untouched', () => {
    expect(sidebarWidthForViewport(414, 1440)).toBe(414);
    expect(sidebarWidthForViewport(DEFAULT_LEFT_PANEL_WIDTH, 1920)).toBe(DEFAULT_LEFT_PANEL_WIDTH);
  });

  test('a narrow window caps it as a share of the viewport', () => {
    expect(sidebarWidthForViewport(414, 1024)).toBe(328);
    expect(sidebarWidthForViewport(414, 900)).toBe(288);
  });

  test('the column floor wins over the share, so the list stays usable', () => {
    // 0.32 x 768 is 246 and 0.32 x 600 is 192, both under the 264 floor the
    // session list reads at — below ~825 the floor is what binds, and 768 is
    // the narrowest window the DESKTOP layout is drawn in at all.
    expect(sidebarWidthForViewport(414, 768)).toBe(MIN_LEFT_PANEL_WIDTH);
    expect(sidebarWidthForViewport(414, 600)).toBe(MIN_LEFT_PANEL_WIDTH);
  });

  test('an unmeasured viewport leaves the width alone', () => {
    // The first paint can happen before any window is measured; a 0 would
    // otherwise collapse the column to its floor.
    expect(sidebarWidthForViewport(414, 0)).toBe(414);
  });
});
