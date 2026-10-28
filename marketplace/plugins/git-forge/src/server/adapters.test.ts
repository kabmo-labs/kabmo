/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GitHub's adapter, over recorded bodies.
 *
 * A live host cannot be part of a test: it needs a credential, a network and a
 * repository that does not change. So the mapping is driven against the exact
 * JSON the vendor documents, which is the only part of an adapter that can be
 * wrong — the fetching is `http.ts`'s own subject. GitLab's half is its own file
 * for the same reason: the two disagree on nearly every field.
 *
 * The cases below are the ones that silently mislead rather than fail:
 *
 * - **A pull request appears in the ISSUES response.** Filtering it out of a
 *   full page left ZERO issues on a real repository, which is why the issues
 *   section reads the search endpoint instead.
 * - **`merged_at` and `draft` are states of their own.** Calling a merged PR
 *   "closed" hides what happened; calling a draft "open" hides what it is.
 * - **A release is keyed by its tag**, and a prerelease says so.
 */

import { describe, expect, test } from 'bun:test';

import type { ForgeContext } from './context';
import { detailGithub, listGithub } from './github';
import { coldCache, host } from './test-host';

function context(overrides: Partial<ForgeContext> & { fetchImpl: typeof fetch }): ForgeContext {
  return {
    provider: 'github',
    apiBase: 'https://api.github.com',
    slug: 'kabmo-labs/kabmo',
    webUrl: 'https://github.com/kabmo-labs/kabmo',
    host: 'github.com',
    token: 'ghp_test',
    perPage: 30,
    cache: coldCache(),
    ...overrides,
  };
}

describe('listGithub', () => {
  test('a pull request in the issues response is not an issue', async () => {
    const { fetchImpl } = host({
      '/search/issues': {
        total_count: 1,
        items: [
          { number: 7, title: 'Real issue', state: 'open', user: { login: 'ana' }, updated_at: '2026-01-01' },
          {
            number: 8,
            title: 'A PR',
            state: 'open',
            user: { login: 'bo' },
            pull_request: { url: 'x' },
            updated_at: '2026-01-02',
          },
        ],
      },
      '/repos/kabmo-labs/kabmo/pulls': [],
      '/repos/kabmo-labs/kabmo/releases': [],
    });

    const list = await listGithub(context({ fetchImpl }), 'open');
    expect(list.sections.issues.items.map((item) => item.number)).toEqual([7]);
  });

  test('a pull request reports merged and draft as their own states', async () => {
    const { fetchImpl } = host({
      '/search/issues': [],
      '/repos/kabmo-labs/kabmo/pulls': [
        { number: 1, title: 'Merged', state: 'closed', merged_at: '2026-01-01', user: { login: 'a' } },
        { number: 2, title: 'Draft', state: 'open', draft: true, user: { login: 'a' } },
        { number: 3, title: 'Open', state: 'open', user: { login: 'a' } },
      ],
      '/repos/kabmo-labs/kabmo/releases': [],
    });

    const list = await listGithub(context({ fetchImpl }), 'open');
    expect(list.sections.pulls.items.map((item) => item.state)).toEqual(['merged', 'draft', 'open']);
  });

  test('a release is keyed by its tag and a prerelease says so', async () => {
    const { fetchImpl } = host({
      '/search/issues': [],
      '/repos/kabmo-labs/kabmo/pulls': [],
      '/repos/kabmo-labs/kabmo/releases': [
        { tag_name: 'v1.0.0', name: 'First', published_at: '2026-01-01T00:00:00Z', author: { login: 'a' } },
        { tag_name: 'v2.0.0-rc', prerelease: true, published_at: '2026-02-01T00:00:00Z' },
      ],
    });

    const list = await listGithub(context({ fetchImpl }), 'open');
    expect(list.sections.releases.items.map((item) => item.id)).toEqual(['v1.0.0', 'v2.0.0-rc']);
    expect(list.sections.releases.items.map((item) => item.state)).toEqual(['published', 'prerelease']);
  });

  test('one section failing leaves the others readable, and says so', async () => {
    const { fetchImpl } = host({
      '/search/issues': { total_count: 1, items: [{ number: 1, title: 'ok', state: 'open' }] },
      '/repos/kabmo-labs/kabmo/pulls': { status: 403 },
      '/repos/kabmo-labs/kabmo/releases': [],
    });

    const list = await listGithub(context({ fetchImpl }), 'open');
    expect(list.sections.issues.items).toHaveLength(1);
    expect(list.sections.pulls.items).toEqual([]);
    expect(list.notes.join(' ')).toContain('pulls');
  });

  test('an anonymous read says it is anonymous', async () => {
    const { fetchImpl } = host({
      '/search/issues': [],
      '/repos/kabmo-labs/kabmo/pulls': [],
      '/repos/kabmo-labs/kabmo/releases': [],
    });

    const list = await listGithub(context({ fetchImpl, token: null }), 'open');
    expect(list.notes.join(' ')).toContain('anonymously');
  });

  test('a full page is reported as truncated', async () => {
    const rows = Array.from({ length: 2 }, (_, index) => ({ number: index + 1, title: 't', state: 'open' }));
    const { fetchImpl } = host({
      '/search/issues': { total_count: rows.length, items: rows },
      '/repos/kabmo-labs/kabmo/pulls': [],
      '/repos/kabmo-labs/kabmo/releases': [],
    });

    const list = await listGithub(context({ fetchImpl, perPage: 2 }), 'open');
    expect(list.sections.issues.truncated).toBe(true);
  });

  test('a label list keeps the host colour and drops a bad one', async () => {
    const { fetchImpl } = host({
      '/search/issues': {
        total_count: 1,
        items: [
          {
            number: 1,
            title: 't',
            state: 'open',
            labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'odd', color: 'not-a-colour' }],
          },
        ],
      },
      '/repos/kabmo-labs/kabmo/pulls': [],
      '/repos/kabmo-labs/kabmo/releases': [],
    });

    const list = await listGithub(context({ fetchImpl }), 'open');
    expect(list.sections.issues.items[0].labels).toEqual([
      { name: 'bug', color: 'd73a4a' },
      { name: 'odd', color: null },
    ]);
  });

  test('the state filter reaches the query', async () => {
    const { asked, fetchImpl } = host({
      '/search/issues': [],
      '/repos/kabmo-labs/kabmo/pulls': [],
      '/repos/kabmo-labs/kabmo/releases': [],
    });
    await listGithub(context({ fetchImpl }), 'closed');
    expect(asked.some((url) => url.includes('/search/issues?q=') && url.includes('state%3Aclosed'))).toBe(true);
    expect(asked.some((url) => url.includes('/pulls?state=closed'))).toBe(true);
  });
});

describe('detailGithub', () => {
  test('a pull request detail carries branch, diff and file facts', async () => {
    const { fetchImpl } = host({
      '/repos/kabmo-labs/kabmo/pulls/12': {
        number: 12,
        title: 'Add a thing',
        state: 'open',
        body: 'Why this exists.',
        head: { ref: 'feat/thing' },
        base: { ref: 'main' },
        additions: 12,
        deletions: 3,
        changed_files: 4,
        mergeable: true,
      },
      '/repos/kabmo-labs/kabmo/issues/12/comments': [
        { id: 1, user: { login: 'ana' }, body: 'Looks good', created_at: '2026-01-01', html_url: 'u' },
      ],
    });

    const detail = await detailGithub(context({ fetchImpl }), 'pulls', '12');
    if ('error' in detail) throw new Error(detail.error);
    expect(detail.body).toBe('Why this exists.');
    expect(detail.facts).toEqual([
      { label: 'branch', value: 'main ← feat/thing' },
      { label: 'diff', value: '+12 −3' },
      { label: 'files', value: '4' },
      { label: 'mergeable', value: 'yes' },
    ]);
    expect(detail.comments.map((comment) => comment.author)).toEqual(['ana']);
  });

  test('a release has no comment thread', async () => {
    const { asked, fetchImpl } = host({
      '/repos/kabmo-labs/kabmo/releases/tags/v1': { tag_name: 'v1', name: 'One', body: 'notes' },
    });

    const detail = await detailGithub(context({ fetchImpl }), 'releases', 'v1');
    if ('error' in detail) throw new Error(detail.error);
    expect(detail.comments).toEqual([]);
    expect(asked.some((url) => url.includes('/comments'))).toBe(false);
  });

  test('a failed detail read is a sentence', async () => {
    const { fetchImpl } = host({});
    const detail = await detailGithub(context({ fetchImpl }), 'issues', '404');
    expect('error' in detail).toBe(true);
  });
});
