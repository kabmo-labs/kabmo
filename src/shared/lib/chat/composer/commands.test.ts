/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * WHY: `/`-command filtering and ranking decide what the popup offers and in
 * what order, and the text it inserts is sent to omp verbatim. The ranking is a
 * deliberate port of oh-my-pi's `buildSlashCommandCompletions`, so a regression
 * silently reorders the list the user picks from. These cases pin the `/skill:`
 * namespace collapse, the bare-name breakout tie rule, alias surfacing, and the
 * description-only fallback.
 */

import { describe, expect, test } from 'bun:test';

import type { ComposerMatchItem, ComposerPickItem } from '@/shared/types';
import { commandArgumentItems, filterCommandItems } from '@/shared/lib/chat/composer/commands';

function cmd(name: string, over: Partial<ComposerPickItem> = {}): ComposerPickItem {
  return { id: `c-${name}`, name, description: '', kind: 'command', source: 'command', token: `/${name}`, ...over };
}

function skill(name: string, description = ''): ComposerPickItem {
  return {
    id: `s-${name}`,
    name: `skill:${name}`,
    description,
    kind: 'skill',
    source: 'skill',
    token: `/skill:${name}`,
  };
}

const names = (items: ComposerMatchItem[]): string[] => items.map((i) => i.name);
const tokens = (items: ComposerMatchItem[]): string[] => items.map((i) => i.token);
const matches = (items: ComposerMatchItem[]) => items.map((i) => i.match);

describe('filterCommandItems — empty query', () => {
  test('surfaces the namespace row first, then commands in list order', () => {
    const pool = [cmd('model'), cmd('fast'), skill('handoff'), cmd('retry'), skill('zoom-out')];

    const result = filterCommandItems(pool, '');

    expect(tokens(result)).toEqual(['/skill:', '/model', '/fast', '/retry']);
    expect(matches(result)).toEqual([null, null, null, null]);
  });

  test('the namespace row carries the collapsed skill count and no trailing space', () => {
    const [row] = filterCommandItems([cmd('model'), skill('handoff'), skill('zoom-out')], '');

    expect(row).toMatchObject({
      id: 'command-skill-namespace',
      name: 'skill:',
      token: '/skill:',
      kind: 'skill',
      source: 'skill',
      insertWithoutSpace: true,
      description: '2 skills',
      match: null,
    });
  });

  test('a single skill is described in the singular', () => {
    const [row] = filterCommandItems([skill('handoff')], '');
    expect(row.description).toBe('1 skill');
  });

  test('no skills means no namespace row', () => {
    expect(names(filterCommandItems([cmd('model'), cmd('fast')], ''))).toEqual(['model', 'fast']);
  });

  test('an empty pool yields nothing', () => {
    expect(filterCommandItems([], '')).toEqual([]);
  });
});

describe('filterCommandItems — namespace approach', () => {
  const pool = [cmd('model'), skill('handoff'), skill('zoom-out')];

  test('a prefix of "skill:" collapses every skill into the row', () => {
    const result = filterCommandItems(pool, 'sk');
    expect(names(result)).toEqual(['skill:']);
    expect(matches(result)).toEqual([{ start: 0, end: 2 }]);
  });

  test('commands matching the same prefix still rank beside the row, in list order', () => {
    const result = filterCommandItems([cmd('security'), skill('handoff')], 's');
    expect(tokens(result)).toEqual(['/security', '/skill:']);
    expect(matches(result)).toEqual([{ start: 0, end: 1 }, { start: 0, end: 1 }]);
  });

  test('typing the namespace itself un-collapses the skills', () => {
    const result = filterCommandItems(pool, 'skill:');
    expect(names(result)).toEqual(['skill:handoff', 'skill:zoom-out']);
    expect(matches(result)).toEqual([{ start: 0, end: 6 }, { start: 0, end: 6 }]);
  });

  test('a namespace query no skill satisfies yields nothing', () => {
    expect(filterCommandItems(pool, 'skill:x')).toEqual([]);
  });
});

describe('filterCommandItems — skill breakout', () => {
  const pool = [
    cmd('model'),
    cmd('fast'),
    cmd('retry'),
    cmd('rename'),
    skill('handoff'),
    skill('zoom-out'),
    skill('research-last30days'),
  ];

  test('an exact bare name breaks the skill out of the namespace', () => {
    const result = filterCommandItems(pool, 'handoff');
    expect(names(result)).toEqual(['skill:handoff']);
    expect(matches(result)).toEqual([null]);
  });

  test('a bare-name prefix and a later hyphen segment both break out', () => {
    expect(names(filterCommandItems(pool, 'han'))).toEqual(['skill:handoff']);
    expect(names(filterCommandItems(pool, 'zoom'))).toEqual(['skill:zoom-out']);
    expect(names(filterCommandItems(pool, 'out'))).toEqual(['skill:zoom-out']);
    expect(names(filterCommandItems(pool, 'last'))).toEqual(['skill:research-last30days']);
  });

  test('a tie with a command name keeps the popup command-only', () => {
    const tiePool = [cmd('retry'), cmd('rename'), skill('research')];
    const result = filterCommandItems(tiePool, 're');
    expect(names(result)).toEqual(['retry', 'rename']);
    expect(matches(result)).toEqual([{ start: 0, end: 2 }, { start: 0, end: 2 }]);
  });

  test('a strictly stronger skill match wins', () => {
    const tiePool = [cmd('retry'), cmd('rename'), skill('research')];
    expect(names(filterCommandItems(tiePool, 'res'))).toEqual(['skill:research']);
  });

  test('a skill reachable only by fuzzy description never surfaces', () => {
    const fuzzy = [
      cmd('compact', { description: 'Compact the conversation' }),
      skill('handoff', 'Hand off the conversation'),
    ];
    const result = filterCommandItems(fuzzy, 'conversation');
    expect(names(result)).toEqual(['compact']);
    expect(matches(result)).toEqual([null]);
  });

  test('an unmatched query yields nothing', () => {
    expect(filterCommandItems(pool, 'zzz')).toEqual([]);
  });
});

describe('filterCommandItems — ranking order', () => {
  test('exact beats prefix beats substring beats description', () => {
    const pool = [cmd('omni-model'), cmd('models'), cmd('model'), cmd('plain', { description: 'has model inside' })];

    const result = filterCommandItems(pool, 'model');

    expect(names(result)).toEqual(['model', 'models', 'omni-model', 'plain']);
    expect(matches(result)).toEqual([{ start: 0, end: 5 }, { start: 0, end: 5 }, null, null]);
  });

  test('equal scores keep the original list order', () => {
    expect(names(filterCommandItems([cmd('rename'), cmd('retry')], 're'))).toEqual(['rename', 'retry']);
  });

  test('a subsequence-only name match is included without a match range', () => {
    const result = filterCommandItems([cmd('model')], 'mdl');
    expect(names(result)).toEqual(['model']);
    expect(matches(result)).toEqual([null]);
  });
});

describe('filterCommandItems — aliases', () => {
  test('an alias that outscores the command name becomes the inserted token', () => {
    const [result] = filterCommandItems([cmd('model', { aliases: ['models'] })], 'models');
    expect(result).toMatchObject({ name: 'models', token: '/models', match: { start: 0, end: 6 } });
  });

  test('an exact command name beats its alias', () => {
    const [result] = filterCommandItems([cmd('model', { aliases: ['models'] })], 'model');
    expect(result).toMatchObject({ name: 'model', token: '/model', match: { start: 0, end: 5 } });
  });

  test('a prefix alias surfaces while the name does not match', () => {
    const [result] = filterCommandItems([cmd('wt', { aliases: ['worktree'] })], 'work');
    expect(result).toMatchObject({ name: 'worktree', token: '/worktree', match: { start: 0, end: 4 } });
  });

  test('a name match beats a weaker alias subsequence', () => {
    const [result] = filterCommandItems([cmd('wt', { aliases: ['worktree'] })], 'wt');
    expect(result).toMatchObject({ name: 'wt', token: '/wt', match: { start: 0, end: 2 } });
  });

  test('a tie with the name keeps the name', () => {
    const [result] = filterCommandItems([cmd('model', { aliases: ['models'] })], 'mode');
    expect(result).toMatchObject({ name: 'model', token: '/model', match: { start: 0, end: 4 } });
  });

  test('an alias identical to the name is ignored', () => {
    const [result] = filterCommandItems([cmd('foo', { aliases: ['foo'] })], 'foo');
    expect(result).toMatchObject({ name: 'foo', token: '/foo', match: { start: 0, end: 3 } });
  });
});

describe('filterCommandItems — mid-prompt', () => {
  const pool = [cmd('retry'), skill('handoff'), skill('zoom-out')];

  test('only skills surface, never ordinary commands', () => {
    expect(filterCommandItems(pool, 'ret', true)).toEqual([]);
    expect(names(filterCommandItems(pool, 'han', true))).toEqual(['skill:handoff']);
  });

  test('a namespace prefix matches every skill', () => {
    const result = filterCommandItems(pool, 'sk', true);
    expect(names(result)).toEqual(['skill:handoff', 'skill:zoom-out']);
    expect(matches(result)).toEqual([{ start: 0, end: 2 }, { start: 0, end: 2 }]);
  });

  test('an empty query keeps every skill, never the namespace row', () => {
    const result = filterCommandItems(pool, '', true);
    expect(names(result)).toEqual(['skill:handoff', 'skill:zoom-out']);
    expect(matches(result)).toEqual([null, null]);
  });

  test('a namespaced query matches the skill name', () => {
    const result = filterCommandItems(pool, 'skill:han', true);
    expect(names(result)).toEqual(['skill:handoff']);
    expect(matches(result)).toEqual([{ start: 0, end: 9 }]);
  });
});

describe('commandArgumentItems', () => {
  const FAST = cmd('fast', {
    subcommands: [
      { name: 'on', description: 'Enable fast mode' },
      { name: 'off', description: 'Disable fast mode' },
      { name: 'status', description: 'Show fast mode status' },
    ],
  });

  test('an empty query lists every subcommand in declaration order', () => {
    const result = commandArgumentItems([FAST], 'fast', '');
    expect(names(result)).toEqual(['on', 'off', 'status']);
    expect(result.map((i) => i.id)).toEqual(['c-fast-sub-on', 'c-fast-sub-off', 'c-fast-sub-status']);
    expect(result.map((i) => i.match)).toEqual([null, null, null]);
    expect(result.map((i) => i.token)).toEqual(['on', 'off', 'status']);
    expect(result.every((i) => i.kind === 'command' && i.source === 'command')).toBe(true);
  });

  test('the subcommand prefix is matched case-insensitively', () => {
    expect(names(commandArgumentItems([FAST], 'fast', 'o'))).toEqual(['on', 'off']);
    expect(names(commandArgumentItems([FAST], 'fast', 'O'))).toEqual(['on', 'off']);
    expect(names(commandArgumentItems([FAST], 'fast', 'st'))).toEqual(['status']);
    expect(names(commandArgumentItems([FAST], 'fast', 's'))).toEqual(['status']);
  });

  test('the match range covers the typed prefix', () => {
    expect(commandArgumentItems([FAST], 'fast', 'o').map((i) => i.match)).toEqual([
      { start: 0, end: 1 },
      { start: 0, end: 1 },
    ]);
  });

  test('a space in the argument text completes nothing', () => {
    expect(commandArgumentItems([FAST], 'fast', 'on ')).toEqual([]);
    expect(commandArgumentItems([FAST], 'fast', 'on x')).toEqual([]);
    expect(commandArgumentItems([FAST], 'fast', ' ')).toEqual([]);
  });

  test('an unknown command offers nothing', () => {
    expect(commandArgumentItems([FAST], 'nope', '')).toEqual([]);
    expect(commandArgumentItems([], 'fast', '')).toEqual([]);
  });

  test('an owner with no subcommands offers nothing', () => {
    expect(commandArgumentItems([cmd('plain')], 'plain', '')).toEqual([]);
  });

  test('an alias resolves the owning command', () => {
    const model = cmd('model', { aliases: ['models'], subcommands: [{ name: 'set' }, { name: 'list' }] });
    const result = commandArgumentItems([model], 'models', '');
    expect(names(result)).toEqual(['set', 'list']);
    expect(result.map((i) => i.id)).toEqual(['c-model-sub-set', 'c-model-sub-list']);
  });

  test('the command name matches case-insensitively', () => {
    expect(names(commandArgumentItems([FAST], 'FAST', ''))).toEqual(['on', 'off', 'status']);
  });

  test('description falls back to usage, then to empty', () => {
    const mixed = cmd('mixed', {
      subcommands: [
        { name: 'a', usage: '[x]' },
        { name: 'b' },
        { name: 'c', description: 'D', usage: 'U' },
      ],
    });
    expect(commandArgumentItems([mixed], 'mixed', '').map((i) => i.description)).toEqual(['[x]', '', 'D']);
  });

  test('a prefix no subcommand shares yields nothing', () => {
    expect(commandArgumentItems([FAST], 'fast', 'zz')).toEqual([]);
  });
});
