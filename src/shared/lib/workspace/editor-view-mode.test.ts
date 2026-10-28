/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The three width modes' table, asserted as data.
 *
 * Each case is a rule the layout depends on and that no component test would
 * catch: `compact` must NOT hide the sidebar (that is `full`'s job, and the
 * two buttons would be the same button if it did), the right panel is hidden
 * by neither, and clicking an active mode returns to `normal` rather than
 * doing nothing.
 */

import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_EDITOR_VIEW_MODE,
  isEditorViewMode,
  editorViewHides,
  toggledEditorViewMode,
} from '@/shared/lib/workspace/editor-view-mode';

describe('editorViewHides', () => {
  test('compact hides the chat only', () => {
    expect(editorViewHides('compact', 'chat')).toBe(true);
    expect(editorViewHides('compact', 'sidebar')).toBe(false);
  });

  test('full hides the chat AND the sidebar', () => {
    expect(editorViewHides('full', 'chat')).toBe(true);
    expect(editorViewHides('full', 'sidebar')).toBe(true);
  });

  test('normal hides nothing', () => {
    expect(editorViewHides('normal', 'chat')).toBe(false);
    expect(editorViewHides('normal', 'sidebar')).toBe(false);
  });
});

describe('toggledEditorViewMode', () => {
  test('a mode button enters its mode', () => {
    expect(toggledEditorViewMode('normal', 'compact')).toBe('compact');
    expect(toggledEditorViewMode('normal', 'full')).toBe('full');
  });

  test('the OTHER mode switches rather than toggling off', () => {
    expect(toggledEditorViewMode('compact', 'full')).toBe('full');
    expect(toggledEditorViewMode('full', 'compact')).toBe('compact');
  });

  test('clicking the active mode returns to normal', () => {
    expect(toggledEditorViewMode('compact', 'compact')).toBe('normal');
    expect(toggledEditorViewMode('full', 'full')).toBe('normal');
  });
});

describe('isEditorViewMode', () => {
  test('accepts the three modes and nothing else', () => {
    expect(['normal', 'compact', 'full'].every(isEditorViewMode)).toBe(true);
    expect(isEditorViewMode('fullscreen')).toBe(false);
    expect(isEditorViewMode(undefined)).toBe(false);
    expect(isEditorViewMode(null)).toBe(false);
  });

  test('the fallback is the ordinary layout', () => {
    expect(DEFAULT_EDITOR_VIEW_MODE).toBe('normal');
  });
});
