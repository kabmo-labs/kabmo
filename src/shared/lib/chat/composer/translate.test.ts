/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * WHY: everything the composer sends is rewritten before it reaches omp, so a
 * translation bug silently corrupts the user's prompt. `@file:` tokens are
 * rewritten to omp's native file-mention syntax, and `@agent` tokens are
 * stripped from the body and replaced by a delegation header. The edge cases
 * that matter are the ones that decide whether a token is a mention at all:
 * quoted paths with spaces, trailing prose punctuation, a bare path that must
 * NOT be swallowed as an agent name, and a draft that is nothing but mentions.
 */

import { describe, expect, test } from 'bun:test';

import { extractAgentMentions, translateAgentMentions, translateFileMentions } from '@/shared/lib/chat/composer/translate';

const AGENTS = ['architect', 'sonic', 'Archivist'];

describe('translateFileMentions', () => {
  test('rewrites a bare @file: token to a native @path mention', () => {
    expect(translateFileMentions('@file:src/a.ts')).toBe('@src/a.ts');
    expect(translateFileMentions('read @file:src/lib/x.ts now')).toBe('read @src/lib/x.ts now');
  });

  test('rewrites a quoted @file: token, keeping the quotes', () => {
    expect(translateFileMentions('@"file:my docs/a.ts"')).toBe('@"my docs/a.ts"');
    expect(translateFileMentions('see @"file:a b.txt" end')).toBe('see @"a b.txt" end');
  });

  test('the quoted form is rewritten before the bare form can see it', () => {
    // The bare regex needs `@file:` immediately; after the quoted pass the
    // token is `@"..."`, so the two rules cannot fight over one mention.
    expect(translateFileMentions('@"file:one two" @file:three')).toBe('@"one two" @three');
  });

  test('every opening delimiter qualifies, and all occurrences are rewritten', () => {
    expect(translateFileMentions('(@file:a.ts)')).toBe('(@a.ts)');
    expect(translateFileMentions('[@file:a.ts]')).toBe('[@a.ts]');
    expect(translateFileMentions('{@file:a.ts}')).toBe('{@a.ts}');
    expect(translateFileMentions('@file:a.ts and @file:b.ts')).toBe('@a.ts and @b.ts');
  });

  test('a mid-token @file: is left alone', () => {
    expect(translateFileMentions('foo@file:a.ts')).toBe('foo@file:a.ts');
  });

  test('text with no file mentions is untouched', () => {
    expect(translateFileMentions('plain text')).toBe('plain text');
    expect(translateFileMentions('@sonic do it')).toBe('@sonic do it');
    expect(translateFileMentions('')).toBe('');
  });

  test('a trailing period in the path is preserved', () => {
    // A path can legitimately end in `.`, and the picker inserts a space, so
    // no trailing-punctuation stripping happens here.
    expect(translateFileMentions('@file:foo.test.ts')).toBe('@foo.test.ts');
  });
});

describe('extractAgentMentions', () => {
  test('a bare known name is matched with its span over @token', () => {
    expect(extractAgentMentions('@architect do it', AGENTS)).toEqual([{ name: 'architect', start: 0, end: 10 }]);
    expect(extractAgentMentions('see @sonic', AGENTS)).toEqual([{ name: 'sonic', start: 4, end: 10 }]);
  });

  test('name matching is case-insensitive but the original casing is kept', () => {
    expect(extractAgentMentions('@Architect hi', AGENTS)).toEqual([{ name: 'Architect', start: 0, end: 10 }]);
    expect(extractAgentMentions('@SONIC hi', AGENTS)).toEqual([{ name: 'SONIC', start: 0, end: 6 }]);
  });

  test('quoted tokens are matched verbatim, with the span covering the quotes', () => {
    expect(extractAgentMentions('@"architect" hi', AGENTS)).toEqual([{ name: 'architect', start: 0, end: 12 }]);
    expect(extractAgentMentions("@'sonic' hi", AGENTS)).toEqual([{ name: 'sonic', start: 0, end: 8 }]);
  });

  test('trailing prose punctuation is stripped before matching a bare token', () => {
    // Span ends at the name, leaving the `.` in the draft.
    expect(extractAgentMentions('ping @architect.', AGENTS)).toEqual([{ name: 'architect', start: 5, end: 15 }]);
    expect(extractAgentMentions('@sonic, go', AGENTS)).toEqual([{ name: 'sonic', start: 0, end: 6 }]);
    expect(extractAgentMentions('(@sonic)', AGENTS)).toEqual([{ name: 'sonic', start: 1, end: 7 }]);
  });

  test('a bare path is never swallowed as an agent name', () => {
    // `build` is not in this pool, but even a known name must not match when
    // the whole token is `build/x.ts`.
    expect(extractAgentMentions('@build/x.ts', ['build'])).toEqual([]);
    expect(extractAgentMentions('@sonic/x.ts', AGENTS)).toEqual([]);
  });

  test('a mid-token or unknown mention yields nothing', () => {
    expect(extractAgentMentions('foo@architect', AGENTS)).toEqual([]);
    expect(extractAgentMentions('@nobody hi', AGENTS)).toEqual([]);
    expect(extractAgentMentions('no mentions here', AGENTS)).toEqual([]);
  });

  test('an empty agent pool matches nothing', () => {
    expect(extractAgentMentions('@architect', [])).toEqual([]);
  });

  test('every occurrence is returned, duplicates included', () => {
    expect(extractAgentMentions('@sonic and @sonic', AGENTS)).toEqual([
      { name: 'sonic', start: 0, end: 6 },
      { name: 'sonic', start: 11, end: 17 },
    ]);
  });

  test('a quoted unknown name is rejected like a bare one', () => {
    expect(extractAgentMentions('@"nobody" hi', AGENTS)).toEqual([]);
  });
});

describe('translateAgentMentions', () => {
  const header = (ids: string, quoted: string): string =>
    `Use the task tool to delegate this request to the following oh-my-pi subagent(s): ${quoted} (agent id: ${ids}).\n\n`;

  test('no mentions leaves the text untouched and the list empty', () => {
    expect(translateAgentMentions('just a prompt', AGENTS)).toEqual({ text: 'just a prompt', agents: [] });
    expect(translateAgentMentions('@nobody', AGENTS)).toEqual({ text: '@nobody', agents: [] });
  });

  test('a mention is removed from the body and named in the header', () => {
    expect(translateAgentMentions('@architect fix the bug', AGENTS)).toEqual({
      text: `${header('architect', '`architect`')}fix the bug`,
      agents: ['architect'],
    });
  });

  test('several agents are listed in encounter order', () => {
    expect(translateAgentMentions('@sonic then @architect go', AGENTS)).toEqual({
      text: `${header('sonic, architect', '`sonic`, `architect`')}then go`,
      agents: ['sonic', 'architect'],
    });
  });

  test('duplicate mentions collapse to one agent but are all removed from the body', () => {
    expect(translateAgentMentions('@sonic and @sonic again', AGENTS)).toEqual({
      text: `${header('sonic', '`sonic`')}and again`,
      agents: ['sonic'],
    });
  });

  test('a draft that is only mentions keeps the original text', () => {
    // There is no request body to delegate, so rewriting it would lose the
    // user's input; the agents list is still reported.
    expect(translateAgentMentions('@sonic @architect', AGENTS)).toEqual({
      text: '@sonic @architect',
      agents: ['sonic', 'architect'],
    });
    expect(translateAgentMentions('  @sonic  ', AGENTS)).toEqual({ text: '  @sonic  ', agents: ['sonic'] });
  });

  test('the gap a removed mention leaves is closed, without reflowing the body', () => {
    expect(translateAgentMentions('@sonic    do   it', AGENTS)).toEqual({
      // The mention's OWN separator and its gap are collapsed…
      text: `${header('sonic', '`sonic`')}do   it`,
      agents: ['sonic'],
    });
    // …while the body's OWN spacing between other words is left alone. The old
    // rule reflowed the whole body here (`do   it` → `do it`) and, on the same
    // pass, dropped every blank line — `@architect\n\nx\n\n---\n\ny` came back
    // with the divider directly under `x`, a setext H2 underline rather than a
    // thematic break.
    expect(translateAgentMentions('@sonic\n\nline\n\n---\n\ntail', AGENTS)).toEqual({
      text: `${header('sonic', '`sonic`')}line\n\n---\n\ntail`,
      agents: ['sonic'],
    });
  });

  test('trailing punctuation stays in the body', () => {
    expect(translateAgentMentions('@architect, please plan', AGENTS)).toEqual({
      text: `${header('architect', '`architect`')}please plan`,
      agents: ['architect'],
    });
  });

  test('a quoted mention is translated like a bare one', () => {
    expect(translateAgentMentions('@"architect" plan it', AGENTS)).toEqual({
      text: `${header('architect', '`architect`')}plan it`,
      agents: ['architect'],
    });
  });

  test('the name casing the user typed is preserved in the header', () => {
    expect(translateAgentMentions('@Archivist sort this', AGENTS)).toEqual({
      text: `${header('Archivist', '`Archivist`')}sort this`,
      agents: ['Archivist'],
    });
  });

  test('a mid-token mention is not translated', () => {
    expect(translateAgentMentions('email foo@architect now', AGENTS)).toEqual({
      text: 'email foo@architect now',
      agents: [],
    });
  });
});
