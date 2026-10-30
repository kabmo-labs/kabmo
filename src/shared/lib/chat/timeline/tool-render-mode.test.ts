/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The tool-render style is a stored string, so it has to survive three things
 * without ever pointing at a renderer that does not exist: a fresh install, a
 * value written by another build, and a corrupted blob.
 *
 * The copy is asserted too, because the settings control is generated from the
 * same table — a mode added without copy renders a card with no label.
 */

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_TOOL_RENDER_MODE,
  TOOL_RENDER_MODE_COPY,
  TOOL_RENDER_MODES,
  isToolRenderMode,
  resolveToolRenderMode,
} from '@/shared/lib/chat/timeline/tool-render-mode';

describe('tool render mode', () => {
  test('every listed mode is a mode, and nothing else is', () => {
    for (const mode of TOOL_RENDER_MODES) expect(isToolRenderMode(mode)).toBe(true);
    expect(isToolRenderMode('cards')).toBe(false);
    expect(isToolRenderMode('')).toBe(false);
    expect(isToolRenderMode(null)).toBe(false);
    expect(isToolRenderMode(undefined)).toBe(false);
    expect(isToolRenderMode(3)).toBe(false);
  });

  test('a value this build cannot draw resolves to the default', () => {
    expect(resolveToolRenderMode('compact')).toBe('compact');
    expect(resolveToolRenderMode('from-a-newer-build')).toBe(DEFAULT_TOOL_RENDER_MODE);
    expect(resolveToolRenderMode(undefined)).toBe(DEFAULT_TOOL_RENDER_MODE);
  });

  test('the default is the style Kabmo shipped before the setting existed', () => {
    expect(DEFAULT_TOOL_RENDER_MODE).toBe('card');
  });

  test('every mode carries a label and a description for the settings card', () => {
    for (const mode of TOOL_RENDER_MODES) {
      const copy = TOOL_RENDER_MODE_COPY[mode];
      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.description.length).toBeGreaterThan(0);
    }
  });
});
