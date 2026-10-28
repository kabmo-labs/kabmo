/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The blame parser and its lookups.
 *
 * The fixtures are SHAPED LIKE MEASURED git output rather than idealized: one
 * header per line with the group count on the first, metadata only where a
 * commit first appears, and a `\t`-prefixed content line ending each record.
 * Every one of those facts was wrong in a first cut and produced a payload that
 * looked plausible — overlapping runs, and commits with an empty author.
 */

import { describe, expect, test } from 'bun:test';

import {
  blameAt,
  blameLabel,
  blameRunAt,
  blameUnavailableText,
  formatBlameAge,
  isUncommittedSha,
  parseBlameHistory,
  parseBlamePorcelain,
  type BlamePayload,
} from '@/shared/lib/fs/git-blame';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const UNCOMMITTED = '0'.repeat(40);

/** Real `--porcelain` shape: header, metadata once, `\t` content, repeat. */
const PORCELAIN = [
  `${SHA_A} 1 1 3`,
  'author Ada Lovelace',
  'author-mail <ada@example.com>',
  'author-time 1700000000',
  'author-tz +0000',
  'committer Ada Lovelace',
  'committer-mail <ada@example.com>',
  'committer-time 1700000000',
  'committer-tz +0000',
  'summary feat: open the file',
  'previous 1111111111111111111111111111111111111111 src/old name.ts',
  'filename src/new name.ts',
  '\tconst a = 1;',
  // Second and third lines of the SAME commit: a bare header each, no metadata.
  `${SHA_A} 2 2`,
  '\tconst b = 2;',
  `${SHA_A} 3 3`,
  '\tconst c = 3;',
  // A different commit: metadata again, because this sha is new.
  `${SHA_B} 4 4 1`,
  'author Grace Hopper',
  'author-mail <grace@example.com>',
  'author-time 1700100000',
  'summary fix: the bug',
  '\tconst d = 4;',
  // A line that is not in HEAD.
  `${UNCOMMITTED} 5 5 1`,
  'author Not Committed Yet',
  'author-mail <not.committed.yet>',
  'author-time 1700200000',
  'summary Version of src/new name.ts from src/new name.ts',
  '\tconst e = 5;',
  '',
].join('\n');

describe('parseBlamePorcelain', () => {
  test('merges consecutive lines of one commit into a single run', () => {
    const { runs } = parseBlamePorcelain(PORCELAIN);
    expect(runs).toEqual([
      { from: 1, to: 3, sha: SHA_A },
      { from: 4, to: 4, sha: SHA_B },
      { from: 5, to: 5, sha: UNCOMMITTED },
    ]);
  });

  test('reads metadata once per commit, not once per line', () => {
    const { commits } = parseBlamePorcelain(PORCELAIN);
    expect(commits[SHA_A]).toEqual({
      sha: SHA_A,
      author: 'Ada Lovelace',
      mail: 'ada@example.com',
      time: 1700000000,
      summary: 'feat: open the file',
    });
    // Three headers named SHA_A; only the first carried metadata, and the
    // record must still be complete.
    expect(commits[SHA_B].author).toBe('Grace Hopper');
    expect(commits[UNCOMMITTED].author).toBe('Not Committed Yet');
  });

  test('ignores boundary, previous and filename lines', () => {
    const { commits, runs } = parseBlamePorcelain(
      [`${SHA_A} 1 1 1`, 'boundary', 'author Ada', 'author-time 1', '\tone', ''].join('\n'),
    );
    expect(runs).toEqual([{ from: 1, to: 1, sha: SHA_A }]);
    expect(commits[SHA_A]).toEqual({ sha: SHA_A, author: 'Ada', mail: '', time: 1, summary: '' });
  });

  test('a content line with no header is ignored rather than attributed', () => {
    const { runs } = parseBlamePorcelain('\tstray\n');
    expect(runs).toEqual([]);
  });

  test('sorts runs by their first line, whatever order git emitted', () => {
    const out = [
      `${SHA_B} 9 9 1`,
      'author G',
      '\tnine',
      `${SHA_A} 2 2 1`,
      'author A',
      '\ttwo',
      '',
    ].join('\n');
    expect(parseBlamePorcelain(out).runs.map((run) => run.from)).toEqual([2, 9]);
  });

  test('an empty document yields no runs and no commits', () => {
    expect(parseBlamePorcelain('')).toEqual({ commits: {}, runs: [] });
  });
});

describe('blameRunAt', () => {
  const runs = [
    { from: 1, to: 3, sha: SHA_A },
    { from: 5, to: 9, sha: SHA_B },
  ];

  test('finds a line inside a run and on both of its edges', () => {
    expect(blameRunAt(runs, 1)?.sha).toBe(SHA_A);
    expect(blameRunAt(runs, 3)?.sha).toBe(SHA_A);
    expect(blameRunAt(runs, 7)?.sha).toBe(SHA_B);
    expect(blameRunAt(runs, 9)?.sha).toBe(SHA_B);
  });

  test('a gap between runs and a line past the end answer null', () => {
    expect(blameRunAt(runs, 4)).toBeNull();
    expect(blameRunAt(runs, 10)).toBeNull();
    expect(blameRunAt([], 1)).toBeNull();
  });
});

describe('blameAt', () => {
  const payload: BlamePayload = {
    available: true,
    head: SHA_B,
    lines: 5,
    ...parseBlamePorcelain(PORCELAIN),
  };

  test('pairs the run with its commit', () => {
    expect(blameAt(payload, 4)?.commit.author).toBe('Grace Hopper');
    expect(blameAt(payload, 4)?.run).toEqual({ from: 4, to: 4, sha: SHA_B });
  });

  test('an unavailable payload answers null even for a line it could place', () => {
    const empty: BlamePayload = {
      available: false,
      head: null,
      lines: 0,
      runs: [],
      commits: {},
      reason: 'untracked',
    };
    expect(blameAt(empty, 1)).toBeNull();
  });

  test('a run whose commit is missing answers null rather than a blank card', () => {
    const broken: BlamePayload = {
      available: true,
      head: SHA_A,
      lines: 1,
      runs: [{ from: 1, to: 1, sha: SHA_A }],
      commits: {},
    };
    expect(blameAt(broken, 1)).toBeNull();
  });
});

describe('formatBlameAge', () => {
  const now = 1_700_000_000_000;

  test('every unit boundary reads as the smaller unit', () => {
    expect(formatBlameAge(now / 1000, now)).toBe('just now');
    expect(formatBlameAge(now / 1000 - 59, now)).toBe('just now');
    expect(formatBlameAge(now / 1000 - 60, now)).toBe('1m ago');
    expect(formatBlameAge(now / 1000 - 3599, now)).toBe('59m ago');
    expect(formatBlameAge(now / 1000 - 3600, now)).toBe('1h ago');
    expect(formatBlameAge(now / 1000 - 86_400, now)).toBe('1d ago');
    expect(formatBlameAge(now / 1000 - 86_400 * 30, now)).toBe('1mo ago');
    expect(formatBlameAge(now / 1000 - 86_400 * 365, now)).toBe('1y ago');
  });

  test('a clock ahead of now reads as just now rather than a negative age', () => {
    expect(formatBlameAge(now / 1000 + 600, now)).toBe('just now');
  });
});

describe('blameLabel', () => {
  test('names the author and the age', () => {
    const commit = { sha: SHA_A, author: 'Ada Lovelace', mail: '', time: 0, summary: '' };
    expect(blameLabel(commit, 86_400_000)).toBe('Ada Lovelace · 1d ago');
  });

  test('an uncommitted line says so instead of naming a fake author', () => {
    const commit = { sha: UNCOMMITTED, author: 'Not Committed Yet', mail: '', time: 0, summary: '' };
    expect(blameLabel(commit, 0)).toBe('Not committed yet');
  });

  test('an empty author falls back rather than drawing a bare separator', () => {
    const commit = { sha: SHA_A, author: '  ', mail: '', time: 0, summary: '' };
    expect(blameLabel(commit, 0)).toBe('Unknown · just now');
  });
});

describe('isUncommittedSha', () => {
  test('only the all-zero sha is uncommitted', () => {
    expect(isUncommittedSha(UNCOMMITTED)).toBe(true);
    expect(isUncommittedSha(SHA_A)).toBe(false);
    expect(isUncommittedSha('0'.repeat(39))).toBe(false);
  });
});

describe('blameUnavailableText', () => {
  test('each reason has its own sentence', () => {
    const seen = new Set(
      (['not-repo', 'no-commit', 'untracked', 'too-large', 'empty', 'error'] as const).map((reason) =>
        blameUnavailableText(reason),
      ),
    );
    expect(seen.size).toBe(6);
  });

  test('a reason that carries git’s own message prints it', () => {
    expect(blameUnavailableText('too-large', 'This file is 12.0 MiB.')).toBe('This file is 12.0 MiB.');
    expect(blameUnavailableText('error', 'fatal: bad object')).toBe('fatal: bad object');
    // The two reasons with a fixed sentence ignore a stray message.
    expect(blameUnavailableText('untracked', 'ignored')).toContain('never been committed');
  });
});

describe('parseBlameHistory', () => {
  test('reads `\\x1f` fields out of `\\x1e` records, newest first as git emits', () => {
    const out = [
      `${SHA_B}\x1fGrace Hopper\x1f1700100000\x1ffix: the bug`,
      `${SHA_A}\x1fAda Lovelace\x1f1700000000\x1ffeat: open the file: part 2`,
    ].join('\x1e');
    expect(parseBlameHistory(out)).toEqual([
      { sha: SHA_B, author: 'Grace Hopper', time: 1700100000, summary: 'fix: the bug' },
      { sha: SHA_A, author: 'Ada Lovelace', time: 1700000000, summary: 'feat: open the file: part 2' },
    ]);
  });

  test('skips a record without four fields and one whose sha is not a sha', () => {
    const out = ['not-a-record', `deadbeef\x1fX\x1f1\x1fsubject`, `${SHA_A}\x1fA\x1f1\x1fok`].join('\x1e');
    expect(parseBlameHistory(out).map((entry) => entry.summary)).toEqual(['ok']);
  });

  test('empty output yields no entries', () => {
    expect(parseBlameHistory('')).toEqual([]);
  });
});
