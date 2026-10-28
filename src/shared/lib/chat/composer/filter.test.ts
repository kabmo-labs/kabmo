/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * WHY: `filterComposerItems` is the single entry point the popup calls, so its
 * dispatch decides whether `@` mentions, `/` commands, or subcommand arguments
 * are offered. The mention ranker is chamber-only (omp completes files by path),
 * and its tiers are what make an exact name beat a prefix beat a substring beat
 * a description hit; `file:` scoping decides whether agents can leak into a
 * file lookup. A regression here surfaces the wrong rows in the wrong order.
 */

import { describe, expect, test } from 'bun:test';

import type { ComposerMatchItem, ComposerPickItem, ComposerTrigger } from '@/shared/types';
import { filterComposerItems } from '@/shared/lib/chat/composer/filter';

function pick(name: string, over: Partial<ComposerPickItem> = {}): ComposerPickItem {
  const isFile = name.includes('/');
  const isSkill = name.startsWith('skill:');
  const kind = isFile ? 'file' : isSkill ? 'skill' : 'agent';
  return { id: `i-${name}`, name, description: '', kind, source: kind, token: isFile ? `@file:${name}` : `@${name}`, ...over };
}

const POOL: ComposerPickItem[] = [
  pick('architect', { description: 'Plans large changes' }),
  pick('sonic', { description: 'Fast mechanical edits' }),
  pick('archivist', { description: 'Archives sessions' }),
  pick('src/arch/x.ts', { description: 'x module' }),
];

const mention = (query: string): ComposerTrigger => ({
  kind: 'mention',
  query,
  start: 0,
  end: query.length + 1,
  phase: 'name',
  replaceFrom: 0,
});

const command = (over: Partial<ComposerTrigger> = {}): ComposerTrigger => ({
  kind: 'command',
  query: '',
  start: 0,
  end: 1,
  phase: 'name',
  replaceFrom: 0,
  ...over,
});

const names = (items: ComposerMatchItem[]): string[] => items.map((i) => i.name);
const matchOf = (items: ComposerMatchItem[]): Array<ComposerMatchItem['match']> => items.map((i) => i.match);

describe('filterComposerItems — mention dispatch', () => {
  test('an empty query returns the whole pool in order, with no highlight', () => {
    const result = filterComposerItems(POOL, mention(''));
    expect(names(result)).toEqual(['architect', 'sonic', 'archivist', 'src/arch/x.ts']);
    expect(matchOf(result)).toEqual([null, null, null, null]);
  });

  test('whitespace-only query is treated as empty', () => {
    expect(names(filterComposerItems(POOL, mention('   ')))).toEqual(['architect', 'sonic', 'archivist', 'src/arch/x.ts']);
  });

  test('an exact name ranks above a prefix above a substring above a description', () => {
    const result = filterComposerItems(POOL, mention('arch'));
    expect(names(result)).toEqual(['architect', 'archivist', 'src/arch/x.ts']);
    expect(matchOf(result)).toEqual([{ start: 0, end: 4 }, { start: 0, end: 4 }, { start: 4, end: 8 }]);
  });

  test('a description-only hit is ranked last with no highlight', () => {
    const result = filterComposerItems(POOL, mention('mechanical'));
    expect(names(result)).toEqual(['sonic']);
    expect(matchOf(result)).toEqual([null]);
  });

  test('the tier order holds when every kind of hit is present', () => {
    const result = filterComposerItems(POOL, mention('a'));
    expect(names(result)).toEqual(['architect', 'archivist', 'src/arch/x.ts', 'sonic']);
    expect(matchOf(result)).toEqual([{ start: 0, end: 1 }, { start: 0, end: 1 }, { start: 4, end: 5 }, null]);
  });

  test('matching is case-insensitive, and the highlight uses the original name', () => {
    const result = filterComposerItems(POOL, mention('ARCH'));
    expect(names(result)).toEqual(['architect', 'archivist', 'src/arch/x.ts']);
    expect(matchOf(result)).toEqual([{ start: 0, end: 4 }, { start: 0, end: 4 }, { start: 4, end: 8 }]);
  });

  test('equal tiers keep the pool order', () => {
    const ties = [pick('beta'), pick('bravo'), pick('delta')];
    expect(names(filterComposerItems(ties, mention('b')))).toEqual(['beta', 'bravo']);
    expect(names(filterComposerItems(ties, mention('d')))).toEqual(['delta']);
  });

  test('an exact match beats a prefix match', () => {
    const pool = [pick('sonicx'), pick('sonic')];
    expect(names(filterComposerItems(pool, mention('sonic')))).toEqual(['sonic', 'sonicx']);
    expect(matchOf(filterComposerItems(pool, mention('sonic')))).toEqual([{ start: 0, end: 5 }, { start: 0, end: 5 }]);
  });

  test('a query matching nothing yields nothing', () => {
    expect(filterComposerItems(POOL, mention('zzz'))).toEqual([]);
  });

  test('the query is trimmed before ranking', () => {
    expect(names(filterComposerItems(POOL, mention('  sonic  ')))).toEqual(['sonic']);
  });
});

describe('filterComposerItems — file: scoping', () => {
  test('file: restricts the pool to files and ranks on the path remainder', () => {
    const result = filterComposerItems(POOL, mention('file:src'));
    expect(names(result)).toEqual(['src/arch/x.ts']);
    expect(matchOf(result)).toEqual([{ start: 0, end: 3 }]);
  });

  test('the path remainder is matched anywhere in the name', () => {
    const result = filterComposerItems(POOL, mention('FILE:ARCH'));
    expect(names(result)).toEqual(['src/arch/x.ts']);
    expect(matchOf(result)).toEqual([{ start: 4, end: 8 }]);
  });

  test('an agent that would match is excluded once file: is typed', () => {
    expect(filterComposerItems(POOL, mention('file:architect'))).toEqual([]);
    expect(filterComposerItems(POOL, mention('file:sonic'))).toEqual([]);
  });

  test('a bare file: lists only files, in order, unhighlighted', () => {
    const result = filterComposerItems(POOL, mention('file:'));
    expect(names(result)).toEqual(['src/arch/x.ts']);
    expect(matchOf(result)).toEqual([null]);
  });

  test('file: with no file items yields nothing', () => {
    expect(filterComposerItems([pick('architect')], mention('file:a'))).toEqual([]);
  });
});

describe('filterComposerItems — command dispatch', () => {
  const COMMANDS: ComposerPickItem[] = [
    pick('fast', {
      kind: 'command',
      source: 'command',
      token: '/fast',
      subcommands: [
        { name: 'on', description: 'Enable fast mode' },
        { name: 'off', description: 'Disable fast mode' },
      ],
    }),
    pick('retry', { kind: 'command', source: 'command', token: '/retry' }),
  ];

  test('a name-phase command trigger uses command filtering', () => {
    expect(names(filterComposerItems(COMMANDS, command({ query: 'ret' })))).toEqual(['retry']);
    expect(names(filterComposerItems(COMMANDS, command({ query: '' })))).toEqual(['fast', 'retry']);
  });

  test('a mid-prompt trigger is forwarded as the mid-prompt flag', () => {
    const skills: ComposerPickItem[] = [
      { id: 's', name: 'skill:handoff', description: '', kind: 'skill', source: 'skill', token: '/skill:handoff' },
      pick('retry', { kind: 'command', source: 'command', token: '/retry' }),
    ];
    expect(names(filterComposerItems(skills, command({ query: 'ret', midPrompt: true })))).toEqual([]);
    expect(names(filterComposerItems(skills, command({ query: 'han', midPrompt: true })))).toEqual(['skill:handoff']);
  });

  test('an args-phase trigger completes the owning command subcommands', () => {
    const trigger = command({ phase: 'args', command: 'fast', query: 'o' });
    expect(names(filterComposerItems(COMMANDS, trigger))).toEqual(['on', 'off']);
  });

  test('an args-phase trigger without a command falls back to name filtering', () => {
    const trigger = command({ phase: 'args', query: 'ret' });
    expect(names(filterComposerItems(COMMANDS, trigger))).toEqual(['retry']);
  });
});
