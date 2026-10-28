/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `/issue` and the readout's own rules, without a host.
 *
 * The command is a pure function over an injected `call`/`insert`/`report`, which
 * is what makes it testable: the alternative is mounting the composer, the
 * plugin runtime and a fake socket to check that a number was parsed.
 */

import { describe, expect, test } from 'bun:test';

import { firstParagraph, parseItemId, quoteFor, runIssueCommand, USAGE } from './command';
import type { ForgeDetail, ForgeItem } from './protocol';

function item(overrides: Partial<ForgeItem> = {}): ForgeItem {
  return {
    id: '12',
    number: 12,
    title: 'A crash on start',
    state: 'open',
    author: 'ana',
    updatedAt: '2026-01-01T00:00:00Z',
    url: 'https://github.com/o/n/issues/12',
    labels: [],
    comments: 0,
    tag: null,
    ...overrides,
  };
}

function detail(body: string): ForgeDetail {
  return {
    item: item(),
    body,
    comments: [],
    facts: [],
    files: [],
    commits: [],
    ci: null,
    capabilities: { comment: true, state: true, review: false, merge: false },
    notes: [],
  };
}

describe('parseItemId', () => {
  test('a bare number, a hash and a URL all name the same item', () => {
    expect(parseItemId('12')).toBe(12);
    expect(parseItemId('#12')).toBe(12);
    expect(parseItemId(' 12 ')).toBe(12);
    expect(parseItemId('https://github.com/o/n/issues/12')).toBe(12);
    expect(parseItemId('https://github.com/o/n/pull/12/')).toBe(12);
    expect(parseItemId('https://gitlab.com/o/n/-/merge_requests/12')).toBe(12);
  });

  test('anything else is refused rather than read as a number', () => {
    for (const args of ['', '  ', 'abc', '#', '12abc', '0', '-3', '1.5']) {
      expect(parseItemId(args)).toBeNull();
    }
  });
});

describe('firstParagraph', () => {
  test('stops at the first blank line', () => {
    expect(firstParagraph('one\ntwo\n\nthree')).toBe('> one\n> two');
  });

  test('bounds a long paragraph and marks the cut', () => {
    const long = 'x'.repeat(700);
    const quoted = firstParagraph(long);
    expect(quoted.endsWith('…')).toBe(true);
    expect(quoted.length).toBeLessThan(700);
  });

  test('every line is quoted, so a fence cannot escape', () => {
    expect(firstParagraph('```ts\nconst a = 1;\n```')).toBe('> ```ts\n> const a = 1;\n> ```');
  });

  test('an empty body yields nothing to quote', () => {
    expect(firstParagraph('   ')).toBe('');
  });
});

describe('quoteFor', () => {
  test('the divider sits after the quote, and a blank line keeps it a rule', () => {
    const text = quoteFor(detail('Body text.'));
    expect(text).toContain('> #12 A crash on start');
    expect(text).toContain('> https://github.com/o/n/issues/12');
    expect(text).toContain('> Body text.');
    // `---` directly under a line of text is a setext heading, so the blank line
    // before it is what makes it a rule.
    expect(text).toContain('\n\n---\n\n');
  });

  test('an item with no description still quotes its identity', () => {
    const text = quoteFor(detail(''));
    expect(text).toBe('> #12 A crash on start\n> https://github.com/o/n/issues/12\n\n---\n\n');
  });

  test('a release quotes its tag rather than a number', () => {
    const text = quoteFor({
      ...detail('Notes'),
      item: item({ number: null, tag: 'v1.2.3', title: 'Release 1.2.3', url: 'https://x/v1.2.3' }),
    });
    expect(text).toContain('> v1.2.3 Release 1.2.3');
  });
});

describe('runIssueCommand', () => {
  test('an issue is quoted, and the text is INSERTED rather than set', async () => {
    const inserted: string[] = [];
    const set: string[] = [];
    await runIssueCommand('12', {
      scope: { root: '/ws', repo: '.' },
      call: async (method) => (method === 'detail' ? { ok: true, value: detail('Body.') } : { ok: false }),
      insert: (text) => inserted.push(text),
      report: () => set.push('reported'),
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toContain('> #12');
    expect(set).toEqual([]);
  });

  test('a number that names a pull request is found in the second collection', async () => {
    const sections: string[] = [];
    await runIssueCommand('#7', {
      scope: { root: '/ws', repo: '.' },
      call: async (_method, input) => {
        const section = (input as { section: string }).section;
        sections.push(section);
        return section === 'pulls'
          ? { ok: true, value: { ...detail('Body.'), item: item({ number: 7 }) } }
          : { ok: false, error: { message: 'Not found (404).' } };
      },
      insert: () => {},
      report: () => {},
    });
    expect(sections).toEqual(['issues', 'pulls']);
  });

  test('no id reports the usage line and calls nothing', async () => {
    let called = false;
    const reported: string[] = [];
    await runIssueCommand('nope', {
      scope: { root: '/ws', repo: '.' },
      call: async () => {
        called = true;
        return { ok: false };
      },
      insert: () => {},
      report: (message) => reported.push(message),
    });
    expect(called).toBe(false);
    expect(reported).toEqual([USAGE]);
  });

  test('no workspace is reported, because there is no repository to ask about', async () => {
    const reported: string[] = [];
    await runIssueCommand('12', {
      scope: null,
      call: async () => ({ ok: false }),
      insert: () => {},
      report: (message) => reported.push(message),
    });
    expect(reported.join(' ')).toContain('open workspace');
  });

  test('both collections refusing reports the first reason', async () => {
    const reported: string[] = [];
    await runIssueCommand('12', {
      scope: { root: '/ws', repo: '.' },
      call: async () => ({ ok: false, error: { message: 'This repository has no origin remote.' } }),
      insert: () => {},
      report: (message) => reported.push(message),
    });
    expect(reported).toEqual(['This repository has no origin remote.']);
  });
});
