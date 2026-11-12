/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { matchesPickerQuery } from '@/shared/lib/ui/picker-filter';

describe('matchesPickerQuery', () => {
  test('an empty query keeps every row', () => {
    expect(matchesPickerQuery('anything', '')).toBe(true);
    expect(matchesPickerQuery('anything', '   ')).toBe(true);
  });

  test('ignores case and separators, so a hyphenated id is found by its words', () => {
    expect(matchesPickerQuery('claude-sonnet-5', 'sonnet 5')).toBe(true);
    expect(matchesPickerQuery('Build pipeline', 'BUILD')).toBe(true);
  });

  test('does not match a term the row never contains', () => {
    expect(matchesPickerQuery('Build pipeline', 'deploy')).toBe(false);
  });
});
