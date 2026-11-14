/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { isModifierKey } from '@/shared/lib/commands/record';

describe('chord recording', () => {
  test('a modifier keydown is not a stroke', () => {
    expect(isModifierKey({ key: 'Meta', code: 'MetaLeft' })).toBe(true);
    expect(isModifierKey({ key: 'Shift', code: 'ShiftRight' })).toBe(true);
    expect(isModifierKey({ key: 'Control', code: 'ControlLeft' })).toBe(true);
  });

  test('WebKit’s `OS` spelling is a modifier too', () => {
    expect(isModifierKey({ key: 'OS', code: 'OSLeft' })).toBe(true);
  });

  test('a real key is a stroke', () => {
    expect(isModifierKey({ key: 'p', code: 'KeyP' })).toBe(false);
    expect(isModifierKey({ key: 'Enter', code: 'Enter' })).toBe(false);
  });
});
