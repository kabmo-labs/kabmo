/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The filter grammars, which are where a filter silently returns nothing.
 *
 * Every case below is a quoting or vocabulary rule that produces a VALID request
 * and an empty result when it is wrong — the failure mode a reader cannot
 * distinguish from "there is nothing here".
 */

import { describe, expect, test } from 'bun:test';

import type { ForgeFilter } from '../protocol';
import { bitbucketQuery, bare, filtersAnything, giteaParams, githubSearch, gitlabParams, quoted } from './filters';

const base: ForgeFilter = { state: 'open', mine: false, label: '', query: '' };

describe('quoted', () => {
  test('wraps a value and drops the quote characters it cannot escape', () => {
    expect(quoted('good first issue')).toBe('"good first issue"');
    expect(quoted('a"b')).toBe('"ab"');
    expect(quoted('a\\b')).toBe('"ab"');
  });
});

describe('bare', () => {
  test('collapses whitespace so one field cannot add a qualifier', () => {
    expect(bare('  a   b  ')).toBe('a b');
  });
});

describe('githubSearch', () => {
  test('the default filter is repo + kind + state', () => {
    expect(githubSearch('o/n', 'issues', base)).toBe('repo:o/n is:issue state:open');
    expect(githubSearch('o/n', 'pulls', base)).toBe('repo:o/n is:pr state:open');
  });

  test('all omits the state qualifier rather than sending `state:all`', () => {
    expect(githubSearch('o/n', 'issues', { ...base, state: 'all' })).not.toContain('state:');
  });

  test('mine becomes assignee:@me', () => {
    expect(githubSearch('o/n', 'issues', { ...base, mine: true })).toContain('assignee:@me');
  });

  test('a label with a space is QUOTED, or the search reads the second word as a qualifier', () => {
    expect(githubSearch('o/n', 'issues', { ...base, label: 'good first issue' })).toContain(
      'label:"good first issue"',
    );
    expect(githubSearch('o/n', 'issues', { ...base, label: 'bug' })).toContain('label:bug');
  });

  test('a quote in the label cannot close the qualifier', () => {
    const q = githubSearch('o/n', 'issues', { ...base, label: 'a"b' });
    expect(q.match(/"/g)?.length).toBe(2);
  });

  test('free text rides as typed, and its whitespace is collapsed', () => {
    expect(githubSearch('o/n', 'issues', { ...base, query: '  crash   on   start ' })).toContain('crash on start');
  });
});

describe('gitlabParams', () => {
  test('the default sends the host its own state word', () => {
    expect(gitlabParams('issues', base)).toEqual({ state: 'opened' });
    expect(gitlabParams('issues', { ...base, state: 'closed' })).toEqual({ state: 'closed' });
    expect(gitlabParams('issues', { ...base, state: 'all' })).toEqual({});
  });

  test('mine becomes scope, never assignee_username', () => {
    expect(gitlabParams('pulls', { ...base, mine: true })).toEqual({ state: 'opened', scope: 'assigned_to_me' });
  });

  test('label and text are their own parameters', () => {
    expect(gitlabParams('issues', { ...base, label: 'bug', query: 'crash' })).toEqual({
      state: 'opened',
      labels: 'bug',
      search: 'crash',
    });
  });

  test('releases carry no filter at all', () => {
    expect(gitlabParams('releases', { ...base, mine: true, label: 'x', query: 'y' })).toEqual({});
  });
});

describe('giteaParams', () => {
  test('the section becomes the type parameter, on one endpoint', () => {
    expect(giteaParams('issues', base)).toEqual({ type: 'issues', state: 'open' });
    expect(giteaParams('pulls', base)).toEqual({ type: 'pulls', state: 'open' });
    expect(giteaParams('releases', base)).toEqual({});
  });

  test('mine is assigned=true and the text is q', () => {
    expect(giteaParams('issues', { ...base, mine: true, query: 'crash' })).toEqual({
      type: 'issues',
      state: 'open',
      assigned: 'true',
      q: 'crash',
    });
  });
});

describe('bitbucketQuery', () => {
  test('closed is the three closed states, because one word cannot say it', () => {
    expect(bitbucketQuery('pulls', { ...base, state: 'closed' })).toContain('state="MERGED"');
    expect(bitbucketQuery('pulls', { ...base, state: 'closed' })).toContain('state="DECLINED"');
  });

  test('an all filter sends no state clause', () => {
    expect(bitbucketQuery('pulls', { ...base, state: 'all' })).toBe('');
  });

  test('a label is a query clause, because there is no parameter for it', () => {
    expect(bitbucketQuery('issues', { ...base, label: 'bug' })).toContain('labels ~ "bug"');
  });

  test('text matches the title', () => {
    expect(bitbucketQuery('issues', { ...base, query: 'crash' })).toContain('title ~ "crash"');
  });
});

describe('filtersAnything', () => {
  test('only the default filter is nothing', () => {
    expect(filtersAnything(base)).toBe(false);
    for (const filter of [
      { ...base, state: 'all' as const },
      { ...base, mine: true },
      { ...base, label: 'bug' },
      { ...base, query: 'crash' },
    ]) {
      expect(filtersAnything(filter)).toBe(true);
    }
  });
});
