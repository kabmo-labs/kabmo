/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The panel drag protocol: what a rail accepts, and which panel it means.
 *
 * Both rails and the left column read these, so the three surfaces cannot
 * disagree about a drop. The two failures they prevent are silent: accepting a
 * dropped URL (a `setPanelSide` the store then refuses looks like a dead drop),
 * and reading the id during `dragover` (the platform blanks `getData` there, so
 * the id is only readable on `drop`).
 */

import { describe, expect, test } from 'bun:test';
import {
  PANEL_DRAG_MIME,
  carriesPanelDrag,
  droppedPanelId,
} from '@/shared/lib/workspace/panel-drag';

describe('carriesPanelDrag', () => {
  test('recognises a panel button drag', () => {
    expect(carriesPanelDrag(['text/plain', PANEL_DRAG_MIME])).toBe(true);
  });

  test('refuses a file, a URL and an absent payload', () => {
    expect(carriesPanelDrag(['text/plain'])).toBe(false);
    expect(carriesPanelDrag(['Files'])).toBe(false);
    expect(carriesPanelDrag(undefined)).toBe(false);
  });
});

describe('droppedPanelId', () => {
  const transfer = (data: Record<string, string>) => ({
    getData: (type: string) => data[type] ?? '',
  });

  test('prefers the panel payload', () => {
    expect(droppedPanelId(transfer({ [PANEL_DRAG_MIME]: 'git', 'text/plain': 'url' }))).toBe('git');
  });

  test('falls back to the plain-text shape', () => {
    expect(droppedPanelId(transfer({ 'text/plain': 'files' }))).toBe('files');
  });

  test('a missing transfer or an empty payload is null, never a blank id', () => {
    expect(droppedPanelId(null)).toBeNull();
    expect(droppedPanelId(transfer({}))).toBeNull();
  });
});
