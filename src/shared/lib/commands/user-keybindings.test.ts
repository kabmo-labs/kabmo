/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { parseUserKeybindings } from '@/shared/lib/commands/user-keybindings';

describe('stored keybindings', () => {
  test('keeps valid chords and explicit unbinds', () => {
    const parsed = parseUserKeybindings({ 'workspace.toggleSidebar': 'alt+b', 'workspace.saveFile': null });
    expect(parsed.bindings).toEqual({ 'workspace.toggleSidebar': 'alt+b', 'workspace.saveFile': null });
    expect(parsed.invalid).toHaveLength(0);
  });

  test('drops a malformed chord with a reason instead of applying it', () => {
    const parsed = parseUserKeybindings({ 'workspace.toggleSidebar': 'hyper+q' });
    expect(parsed.bindings).toEqual({});
    expect(parsed.invalid).toHaveLength(1);
    expect(parsed.invalid[0].id).toBe('workspace.toggleSidebar');
  });

  test('drops a non-string value', () => {
    const parsed = parseUserKeybindings({ 'workspace.toggleSidebar': 3 });
    expect(parsed.bindings).toEqual({});
    expect(parsed.invalid[0].reason).toBe('not a chord');
  });

  test('a non-object is an empty map, not a throw', () => {
    expect(parseUserKeybindings(null).bindings).toEqual({});
    expect(parseUserKeybindings(['cmd+b']).bindings).toEqual({});
  });
});
