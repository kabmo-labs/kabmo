/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { scoreCommand } from '@/shared/lib/commands/score';
import type { CommandMeta } from '@/shared/lib/commands/types';

const command = (title: string, keywords: string[] = []): CommandMeta => ({
  id: title.toLowerCase(),
  title,
  category: 'View',
  keywords,
});

describe('command scoring', () => {
  test('an empty query matches everything with a neutral score', () => {
    expect(scoreCommand(command('Toggle Sidebar'), '')).toBe(0);
  });

  test('an exact title beats a prefix, which beats a substring', () => {
    const exact = scoreCommand(command('Save File'), 'save file')!;
    const prefix = scoreCommand(command('Save File As'), 'save file')!;
    const substring = scoreCommand(command('Reopen Save File'), 'save file')!;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substring);
  });

  test('a keyword hit is found when the title does not contain the word', () => {
    expect(scoreCommand(command('Show All Commands', ['palette']), 'palette')).not.toBeNull();
  });

  test('a subsequence is the last resort', () => {
    expect(scoreCommand(command('Toggle Sidebar'), 'tgsb')).not.toBeNull();
  });

  test('a query that matches nothing is null', () => {
    expect(scoreCommand(command('Toggle Sidebar'), 'zzzz')).toBeNull();
  });
});
