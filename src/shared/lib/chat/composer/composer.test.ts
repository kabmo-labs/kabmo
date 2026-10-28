/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's `/` popup must match oh-my-pi's own editor, because the text
 * it inserts is fed straight back to omp as a prompt. The expected values here
 * were read off `@oh-my-pi/pi-tui`'s `CombinedAutocompleteProvider` driving the
 * same command pool, so a regression in ranking, the `/skill:` namespace
 * collapse, or the subcommand phase fails this file.
 */

import { describe, expect, test } from 'bun:test';

import type { ComposerPickItem } from '@/shared/types';
import { detectComposerTrigger, insertToken, sendInsteadOfAccept, tokenForItem } from '@/shared/lib/chat/composer/trigger';
import { filterComposerItems } from '@/shared/lib/chat/composer/filter';
import { mergeCommandAndSkillItems } from '@/shared/lib/chat/composer/client';

function item(over: Partial<ComposerPickItem> & { name: string }): ComposerPickItem {
  const isSkill = over.name.startsWith('skill:');
  return {
    id: `i-${over.name}`,
    description: '',
    kind: isSkill ? 'skill' : 'command',
    source: isSkill ? 'skill' : 'command',
    token: `/${over.name}`,
    ...over,
  };
}

const POOL: ComposerPickItem[] = [
  item({ name: 'security', description: 'Plan, run, inspect, import, and compare security scans' }),
  item({ name: 'model', description: 'Show current model selection', aliases: ['models'] }),
  item({
    name: 'fast',
    description: 'Toggle fast mode',
    subcommands: [
      { name: 'on', description: 'Enable fast mode' },
      { name: 'off', description: 'Disable fast mode' },
      { name: 'status', description: 'Show fast mode status' },
    ],
  }),
  item({ name: 'retry', description: 'Retry the last failed agent turn' }),
  item({ name: 'rename', description: 'Rename the current session' }),
  item({ name: 'compact', description: 'Compact the conversation' }),
  item({ name: 'wt', description: 'Move this session into a new worktree', aliases: ['worktree'] }),
  item({ name: 'skill:handoff', description: 'Compact the current conversation into a handoff document' }),
  item({ name: 'skill:diagnose', description: 'Disciplined diagnosis loop for hard bugs' }),
  item({ name: 'skill:research-last30days', description: 'Research last 30 days' }),
  item({ name: 'skill:zoom-out', description: 'Zoom out' }),
];

/** Tokens the popup offers for a draft, as omp's provider would order them. */
function tokensFor(text: string, caret = text.length): string[] {
  const trigger = detectComposerTrigger(text, caret);
  return trigger ? filterComposerItems(POOL, trigger).map((m) => m.token) : [];
}

/** What the popup offers after accepting `pick` from `text`. */
function acceptThenRequery(text: string, pick: string): { value: string; requery: string[] } {
  const trigger = detectComposerTrigger(text, text.length);
  if (!trigger) throw new Error(`no trigger for ${text}`);
  const match = filterComposerItems(POOL, trigger).find((m) => m.token === pick || m.name === pick);
  if (!match) throw new Error(`no match ${pick} for ${text}`);
  const next = insertToken(text, trigger, tokenForItem(match));
  return { value: next.value, requery: tokensFor(next.value, next.caret) };
}

describe('composer slash commands', () => {
  test('skills collapse into one namespace row while the prefix is generic', () => {
    expect(tokensFor('/')).toEqual([
      '/skill:',
      '/security',
      '/model',
      '/fast',
      '/retry',
      '/rename',
      '/compact',
      '/wt',
    ]);
  });

  test('a skill breaks out only on a stronger match than every command', () => {
    // `handoff` wins the namespace tier; `zoom-out` matches on a later segment.
    expect(tokensFor('/han')).toEqual(['/skill:handoff', '/retry', '/compact', '/wt']);
    expect(tokensFor('/z')).toEqual(['/skill:zoom-out']);
    // A tie leaves the popup command-only.
    expect(tokensFor('/re')).toEqual(['/retry', '/rename', '/worktree', '/security', '/model']);
  });

  test('an alias outranking its command name is what gets inserted', () => {
    expect(tokensFor('/models')).toEqual(['/models']);
    expect(tokensFor('/worktree')).toEqual(['/worktree']);
  });

  test('a slash token with no command match offers nothing', () => {
    // `/tmp/fo` is a path, not a command: an empty popup would just cover the composer.
    expect(tokensFor('/zzz')).toEqual([]);
    expect(tokensFor('/tmp/fo')).toEqual([]);
    expect(tokensFor('/retry ')).toEqual([]);
  });

  test('a command with subcommands switches to the argument phase', () => {
    expect(tokensFor('/fast ')).toEqual(['on', 'off', 'status']);
    expect(tokensFor('/fast o')).toEqual(['on', 'off']);
    // Past the subcommand, or with a space inside the argument, completion stops.
    expect(tokensFor('/fast on ')).toEqual([]);
    expect(tokensFor('/fast  o')).toEqual([]);
  });

  test('accepting a command reopens on its subcommands, not an empty list', () => {
    expect(acceptThenRequery('/fast', '/fast')).toEqual({ value: '/fast ', requery: ['on', 'off', 'status'] });
    expect(acceptThenRequery('/models', '/models')).toEqual({ value: '/models ', requery: [] });
  });

  test('accepting the namespace row keeps the caret on the namespace', () => {
    // No trailing space: the popup must reopen on the individual skills.
    expect(acceptThenRequery('/sk', '/skill:')).toEqual({
      value: '/skill:',
      requery: ['/skill:handoff', '/skill:diagnose', '/skill:research-last30days', '/skill:zoom-out'],
    });
    expect(acceptThenRequery('/skill:', '/skill:handoff')).toEqual({
      value: '/skill:handoff ',
      requery: [],
    });
  });

  test('a mid-prompt slash token only ever surfaces skills', () => {
    expect(tokensFor('fix bug /skill:han')).toEqual(['/skill:handoff']);
    expect(tokensFor('fix bug /han')).toEqual(['/skill:handoff']);
    // `/fast` mid-prose is not a skill, so nothing opens.
    expect(tokensFor('prose /fast')).toEqual([]);
  });

  test('a leading slash survives indentation', () => {
    expect(tokensFor('  /fa')).toEqual(['/fast', '/retry']);
  });
});

describe('composer slash trigger', () => {
  test('reports the phase and the span each accept replaces', () => {
    expect(detectComposerTrigger('/fast', 5)).toMatchObject({ kind: 'command', phase: 'name', query: 'fast', replaceFrom: 0 });
    expect(detectComposerTrigger('/fast o', 7)).toMatchObject({ kind: 'command', phase: 'args', query: 'o', command: 'fast', replaceFrom: 6 });
    // Earlier arguments survive acceptance: the replacement span is the
    // argument text (oh-my-pi's `beforePrefix`), not the whole invocation.
    expect(detectComposerTrigger('/security plan s', 16)).toMatchObject({ phase: 'args', query: 'plan s', replaceFrom: 10 });
    // ...and a space inside the argument ends completion, as in oh-my-pi.
    expect(tokensFor('/security plan s')).toEqual([]);
  });

  test('an @mention trigger keeps its own span', () => {
    expect(detectComposerTrigger('@file:src/a', 11)).toMatchObject({ kind: 'mention', query: 'file:src/a', start: 0 });
    expect(detectComposerTrigger('see @sonic', 10)).toMatchObject({ kind: 'mention', query: 'sonic', start: 4 });
    expect(detectComposerTrigger('foo@bar', 7)).toBeNull();
  });
});

describe('composer Enter on a complete command', () => {
  /** The real popup pool: omp's commands plus Kabmo's own. */
  const CHAMBER_POOL: ComposerPickItem[] = mergeCommandAndSkillItems(
    [{ id: 'c-model', name: 'model', description: 'Show current model selection', scope: 'system', template: '' }],
    [],
  );

  /** Does Enter send here, or does the popup accept the highlighted item? */
  const enterSends = (text: string): boolean => {
    const trigger = detectComposerTrigger(text, text.length);
    if (!trigger) throw new Error(`no trigger for ${text}`);
    const [highlighted] = filterComposerItems(CHAMBER_POOL, trigger);
    return sendInsteadOfAccept(trigger, highlighted);
  };

  test('the chamber-owned /btw sends, so Enter reaches the side-question form', () => {
    expect(enterSends('/btw')).toBe(true);
    expect(enterSends('/BTW')).toBe(true);
  });

  test('a command omp owns still accepts, however complete it looks', () => {
    // `/model` takes no subcommands, but Kabmo does not intercept it:
    // accepting is what the CLI does, and it must stay that way.
    expect(enterSends('/model')).toBe(false);
    expect(enterSends('/mo')).toBe(false);
  });

  test('a command with subcommands still opens its arguments', () => {
    expect(enterSends('/fast')).toBe(false);
  });

  test('arguments and mentions never yield Enter', () => {
    expect(enterSends('/fast o')).toBe(false);
    expect(enterSends('@sonic')).toBe(false);
  });
});
