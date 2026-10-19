/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WHY: `detectComposerTrigger` decides when the popup opens and which span an
 * accept overwrites; `insertToken` performs that overwrite. A wrong caret or
 * `replaceFrom` mangles the user's draft — silently deleting prose or leaving
 * half a command behind — so every case here pins the exact span, not just the
 * kind. The mid-prompt rule matters too: a `/word` inside running prose must
 * only ever surface skills, never the full command list.
 */

import { describe, expect, test } from 'bun:test';

import type { ComposerMatchItem, ComposerPickItem, ComposerTrigger } from '@/shared/types';
import {
  KABMO_COMMANDS,
  detectComposerTrigger,
  insertToken,
  sendInsteadOfAccept,
  tokenForItem,
} from '@/shared/lib/chat/composer/trigger';

function cmd(name: string): ComposerMatchItem {
  return { id: `c-${name}`, name, description: '', kind: 'command', source: 'command', token: `/${name}`, match: null };
}

describe('detectComposerTrigger — command name phase', () => {
  test('a leading slash at the caret opens the name phase', () => {
    expect(detectComposerTrigger('/', 1)).toEqual({
      kind: 'command',
      query: '',
      start: 0,
      end: 1,
      phase: 'name',
      replaceFrom: 0,
    });
    expect(detectComposerTrigger('/fast', 5)).toEqual({
      kind: 'command',
      query: 'fast',
      start: 0,
      end: 5,
      phase: 'name',
      replaceFrom: 0,
    });
  });

  test('the query is only what precedes the caret', () => {
    const trigger = detectComposerTrigger('/fast', 3);
    expect(trigger).toMatchObject({ query: 'fa', start: 0, end: 3, replaceFrom: 0 });
  });

  test('leading whitespace is skipped but the reported span stays absolute', () => {
    expect(detectComposerTrigger('   /fa', 6)).toMatchObject({ query: 'fa', start: 3, replaceFrom: 3, end: 6 });
  });

  test('a slash inside a token never triggers', () => {
    // `/tmp/fo` is a path, but it still starts with a slash, so the trigger
    // fires and the popup simply filters to nothing.
    expect(detectComposerTrigger('/tmp/fo', 7)).toMatchObject({ kind: 'command', query: 'tmp/fo' });
    expect(detectComposerTrigger('a/b', 3)).toBeNull();
  });

  test('plain prose with no slash or at-sign triggers nothing', () => {
    expect(detectComposerTrigger('hello world', 11)).toBeNull();
    expect(detectComposerTrigger('', 0)).toBeNull();
  });

  test('a caret in the middle of the draft scopes detection to its own line', () => {
    expect(detectComposerTrigger('one\ntwo', 7)).toBeNull();
    expect(detectComposerTrigger('one\n/tw', 7)).toMatchObject({ query: 'tw', start: 4, end: 7 });
  });
});

describe('detectComposerTrigger — args phase', () => {
  test('a space after the command switches to args', () => {
    expect(detectComposerTrigger('/fast ', 6)).toEqual({
      kind: 'command',
      query: '',
      start: 0,
      end: 6,
      phase: 'args',
      replaceFrom: 6,
      command: 'fast',
    });
  });

  test('the replacement is anchored on the argument text, keeping earlier arguments', () => {
    const trigger = detectComposerTrigger('/security plan s', 16);
    expect(trigger).toMatchObject({
      kind: 'command',
      phase: 'args',
      command: 'security',
      query: 'plan s',
      start: 0,
      end: 16,
      replaceFrom: 10,
    });
  });

  test('an argument typed before the caret is included in the query', () => {
    expect(detectComposerTrigger('/fast on x', 10)).toMatchObject({ phase: 'args', query: 'on x', command: 'fast' });
    expect(detectComposerTrigger('/fast on x', 8)).toMatchObject({ phase: 'args', query: 'on', command: 'fast' });
  });

  test('the command name is reported as typed', () => {
    expect(detectComposerTrigger('/MODEL ', 7)).toMatchObject({ command: 'MODEL', phase: 'args' });
  });

  test('a leading-slash command with trailing prose is still args on its line', () => {
    expect(detectComposerTrigger('/a b\n', 4)).toMatchObject({ phase: 'args', command: 'a', query: 'b' });
  });
});

describe('detectComposerTrigger — mid-prompt', () => {
  test('prose before the token on the same line marks it mid-prompt', () => {
    expect(detectComposerTrigger('fix bug /han', 12)).toMatchObject({
      kind: 'command',
      phase: 'name',
      query: 'han',
      start: 8,
      replaceFrom: 8,
      midPrompt: true,
    });
  });

  test('an earlier non-blank line marks a later line-start token mid-prompt', () => {
    expect(detectComposerTrigger('prose\n/retry', 12)).toMatchObject({ midPrompt: true, query: 'retry', start: 6 });
  });

  test('a blank earlier line does not', () => {
    expect(detectComposerTrigger('\n\n/retry', 8)).toMatchObject({ query: 'retry', start: 2 });
    expect(detectComposerTrigger('\n\n/retry', 8)?.midPrompt).toBeUndefined();
  });

  test('indentation alone is not prose', () => {
    expect(detectComposerTrigger('   /fa', 6)?.midPrompt).toBeUndefined();
  });

  test('a mid-prompt token never enters the args phase', () => {
    // The trailing-slash rule only matches a slash token with no space after
    // it, so once prose precedes `/fast o` there is no trigger at all: the
    // popup closes rather than completing `fast`'s subcommands mid-prose.
    expect(detectComposerTrigger('prose /fast o', 13)).toBeNull();
    expect(detectComposerTrigger('prose /fast', 11)).toMatchObject({ phase: 'name', query: 'fast', midPrompt: true });
  });
});

describe('detectComposerTrigger — @ mentions', () => {
  test('an at-sign at index 0 opens a mention', () => {
    expect(detectComposerTrigger('@sonic', 6)).toEqual({
      kind: 'mention',
      query: 'sonic',
      start: 0,
      end: 6,
      phase: 'name',
      replaceFrom: 0,
    });
  });

  test('a preceding whitespace or opener bracket is allowed', () => {
    expect(detectComposerTrigger('see @sonic', 10)).toMatchObject({ kind: 'mention', query: 'sonic', start: 4 });
    expect(detectComposerTrigger('(@sonic', 7)).toMatchObject({ kind: 'mention', query: 'sonic', start: 1 });
    expect(detectComposerTrigger('[@sonic', 7)).toMatchObject({ kind: 'mention', query: 'sonic', start: 1 });
    expect(detectComposerTrigger('{@sonic', 7)).toMatchObject({ kind: 'mention', query: 'sonic', start: 1 });
  });

  test('a preceding ordinary character aborts the scan', () => {
    expect(detectComposerTrigger('foo@bar', 7)).toBeNull();
    expect(detectComposerTrigger('a@b', 3)).toBeNull();
  });

  test('the scan stops at whitespace between the at-sign and the caret', () => {
    expect(detectComposerTrigger('@sonic x', 8)).toBeNull();
    expect(detectComposerTrigger('@ sonic', 7)).toBeNull();
  });

  test('the mention query runs to the caret, not the end of the draft', () => {
    expect(detectComposerTrigger('@son', 4)).toMatchObject({ query: 'son', start: 0, end: 4 });
    expect(detectComposerTrigger('@file:src/a', 11)).toMatchObject({ query: 'file:src/a', start: 0, end: 11 });
  });

  test('the at-sign scan is scoped to the caret line', () => {
    expect(detectComposerTrigger('x\n@son', 6)).toMatchObject({ kind: 'mention', query: 'son', start: 2 });
  });

  test('a caret clamped past the end uses the whole text', () => {
    expect(detectComposerTrigger('@son', 99)).toMatchObject({ kind: 'mention', query: 'son', end: 4 });
    expect(detectComposerTrigger('/fa', 99)).toMatchObject({ kind: 'command', query: 'fa', end: 3 });
  });
});

describe('tokenForItem', () => {
  const base: ComposerPickItem = {
    id: 'x',
    name: 'x',
    description: '',
    kind: 'command',
    source: 'command',
    token: '/x',
  };

  test('appends a trailing space by default', () => {
    expect(tokenForItem(base)).toBe('/x ');
  });

  test('suppresses the space when the item asks to', () => {
    expect(tokenForItem({ ...base, insertWithoutSpace: true })).toBe('/x');
  });
});

describe('sendInsteadOfAccept', () => {
  const trigger = (over: Partial<ComposerTrigger>): ComposerTrigger => ({
    kind: 'command',
    query: '',
    start: 0,
    end: 0,
    phase: 'name',
    replaceFrom: 0,
    ...over,
  });

  test('a complete chamber-owned command lets Enter send', () => {
    for (const command of KABMO_COMMANDS) {
      const t = trigger({ query: command.name, phase: 'name' });
      expect(sendInsteadOfAccept(t, cmd(command.name))).toBe(true);
      expect(sendInsteadOfAccept(trigger({ query: command.name.toUpperCase() }), cmd(command.name))).toBe(true);
    }
  });

  test('an incomplete Kabmo command still accepts', () => {
    expect(sendInsteadOfAccept(trigger({ query: 'bt' }), cmd('btw'))).toBe(false);
  });

  test('a command omp owns always accepts, however complete', () => {
    expect(sendInsteadOfAccept(trigger({ query: 'model' }), cmd('model'))).toBe(false);
  });

  test('nothing highlighted, args phase, or mention never sends', () => {
    expect(sendInsteadOfAccept(trigger({ query: 'btw' }), undefined)).toBe(false);
    expect(sendInsteadOfAccept(trigger({ query: 'btw', phase: 'args', command: 'btw' }), cmd('btw'))).toBe(false);
    expect(sendInsteadOfAccept(trigger({ kind: 'mention', query: 'btw' }), cmd('btw'))).toBe(false);
  });
});

describe('insertToken', () => {
  test('splices the token over the name-phase span and lands the caret after it', () => {
    const trigger = detectComposerTrigger('/fa', 3);
    if (!trigger) throw new Error('expected a trigger');

    expect(insertToken('/fa', trigger, '/fast ')).toEqual({ value: '/fast ', caret: 6 });
  });

  test('only the argument text is replaced in the args phase', () => {
    const trigger = detectComposerTrigger('/security plan s', 16);
    if (!trigger) throw new Error('expected a trigger');

    expect(insertToken('/security plan s', trigger, 'scan')).toEqual({ value: '/security scan', caret: 14 });
  });

  test('text after the caret survives the splice', () => {
    const trigger = detectComposerTrigger('/fa', 3);
    if (!trigger) throw new Error('expected a trigger');

    expect(insertToken('/fa rest', trigger, '/fast')).toEqual({ value: '/fast rest', caret: 5 });
  });

  test('a mention span is replaced exactly', () => {
    const trigger = detectComposerTrigger('see @son', 8);
    if (!trigger) throw new Error('expected a trigger');

    expect(insertToken('see @son', trigger, '@sonic ')).toEqual({ value: 'see @sonic ', caret: 11 });
  });
});
