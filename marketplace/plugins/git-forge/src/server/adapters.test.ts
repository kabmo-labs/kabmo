/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * GitHub's adapter, over recorded bodies.
 *
 * A live host cannot be part of a test: it needs a credential, a network and a
 * repository that does not change. So the mapping is driven against the exact
 * JSON the vendor documents, which is the only part of an adapter that can be
 * wrong — the fetching is `http.ts`'s own subject.
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

import { detailGithub, isBotUser, listGithub } from './github';
import { host } from './test-host';
import { hostContext, openFilter } from './test-context';

const github = (fetchImpl: typeof fetch, overrides: Parameters<typeof hostContext>[2] = {}) =>
  hostContext('github', fetchImpl, overrides);

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

    const list = await listGithub(github(fetchImpl));
    expect(list.sections.issues.items.map((item) => item.number)).toEqual([7]);
  });

  test('a pull request reports merged and draft as their own states', async () => {
    const { fetchImpl } = host({
      '/search/issues': {
        total_count: 3,
        items: [
          { number: 1, title: 'Merged', state: 'closed', pull_request: { merged_at: '2026-01-01' } },
          { number: 2, title: 'Draft', state: 'open', draft: true },
          { number: 3, title: 'Open', state: 'open' },
        ],
      },
      '/repos/kabmo-labs/kabmo/releases': [],
    });

    const list = await listGithub(github(fetchImpl));
    expect(list.sections.pulls.items.map((item) => item.state)).toEqual(['merged', 'draft', 'open']);
  });

  test('a release is keyed by its tag and a prerelease says so', async () => {
    const { fetchImpl } = host({
      '/search/issues': { total_count: 0, items: [] },
      '/repos/kabmo-labs/kabmo/releases': [
        { tag_name: 'v1.0.0', name: 'First', published_at: '2026-01-01T00:00:00Z', author: { login: 'a' } },
        { tag_name: 'v2.0.0-rc', prerelease: true, published_at: '2026-02-01T00:00:00Z' },
      ],
    });

    const list = await listGithub(github(fetchImpl));
    expect(list.sections.releases.items.map((item) => item.id)).toEqual(['v1.0.0', 'v2.0.0-rc']);
    expect(list.sections.releases.items.map((item) => item.state)).toEqual(['published', 'prerelease']);
  });

  test('one section failing leaves the others readable, and says so', async () => {
    const { fetchImpl } = host({
      '/search/issues': { total_count: 1, items: [{ number: 1, title: 'ok', state: 'open' }] },
      '/repos/kabmo-labs/kabmo/releases': { status: 403 },
    });

    const list = await listGithub(github(fetchImpl));
    expect(list.sections.issues.items).toHaveLength(1);
    expect(list.sections.releases.items).toEqual([]);
    expect(list.notes.join(' ')).toContain('releases');
  });

  test('an anonymous read says it is anonymous', async () => {
    const { fetchImpl } = host({
      '/search/issues': { total_count: 0, items: [] },
      '/repos/kabmo-labs/kabmo/releases': [],
    });

    const list = await listGithub(github(fetchImpl, { token: null }));
    expect(list.notes.join(' ')).toContain('anonymously');
  });

  test('a full page is reported as truncated, from the host total', async () => {
    const rows = Array.from({ length: 2 }, (_, index) => ({ number: index + 1, title: 't', state: 'open' }));
    const { fetchImpl } = host({
      '/search/issues': { total_count: 90, items: rows },
      '/repos/kabmo-labs/kabmo/releases': [],
    });

    const list = await listGithub(github(fetchImpl, { perPage: 2 }));
    expect(list.sections.issues.truncated).toBe(true);
    expect(list.sections.issues.total).toBe(90);
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
      '/repos/kabmo-labs/kabmo/releases': [],
    });

    const list = await listGithub(github(fetchImpl));
    expect(list.sections.issues.items[0].labels).toEqual([
      { name: 'bug', color: 'd73a4a' },
      { name: 'odd', color: null },
    ]);
  });

  test('the filter reaches the query', async () => {
    const { asked, fetchImpl } = host({
      '/search/issues': { total_count: 0, items: [] },
      '/repos/kabmo-labs/kabmo/releases': [],
    });
    await listGithub(
      github(fetchImpl, { filter: { ...openFilter(), state: 'closed', mine: true, label: 'good first issue' } }),
    );
    const search = asked.find((url) => url.includes('/search/issues'));
    expect(search).toContain('state%3Aclosed');
    expect(search).toContain('assignee%3A%40me');
    // The qualifier's own quotes and space survive the encoding, which is what
    // makes a two-word label one value rather than two qualifiers.
    expect(decodeURIComponent(search ?? '')).toContain('label:"good first issue"');
  });
});

describe('detailGithub', () => {
  test('a pull request detail carries branch, diff, file and CI facts', async () => {
    const { fetchImpl } = host({
      '/repos/kabmo-labs/kabmo/pulls/12': {
        number: 12,
        title: 'Add a thing',
        state: 'open',
        body: 'Why this exists.',
        head: { ref: 'feat/thing', sha: 'abc123', html_url: 'https://github.com/c/abc123' },
        base: { ref: 'main' },
        additions: 12,
        deletions: 3,
        changed_files: 4,
        mergeable: true,
      },
      '/repos/kabmo-labs/kabmo/issues/12/comments': [
        { id: 1, user: { login: 'ana' }, body: 'Looks good', created_at: '2026-01-01', html_url: 'u' },
        { id: 2, user: { login: 'dependabot[bot]', type: 'Bot' }, body: 'Bumped', created_at: '2026-01-02' },
      ],
      '/repos/kabmo-labs/kabmo/commits/abc123/check-runs': {
        check_runs: [
          { name: 'test', status: 'completed', conclusion: 'success' },
          { name: 'lint', status: 'completed', conclusion: 'failure' },
        ],
      },
      '/repos/kabmo-labs/kabmo/pulls/12/files': [
        { filename: 'src/a.ts', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1 @@' },
      ],
      '/repos/kabmo-labs/kabmo/pulls/12/commits': [
        { sha: 'abc123', commit: { message: 'Add a thing\n\nbody', author: { name: 'Ana', date: '2026-01-01' } } },
      ],
    });

    const detail = await detailGithub(github(fetchImpl), 'pulls', '12');
    if ('error' in detail) throw new Error(detail.error);

    expect(detail.body).toBe('Why this exists.');
    expect(detail.facts).toEqual([
      { label: 'branch', value: 'main ← feat/thing' },
      { label: 'diff', value: '+12 −3' },
      { label: 'files', value: '4' },
      { label: 'mergeable', value: 'yes' },
    ]);
    expect(detail.comments.map((comment) => comment.author)).toEqual(['ana', 'dependabot[bot]']);
    expect(detail.comments.map((comment) => comment.bot)).toEqual([false, true]);
    expect(detail.ci).toEqual({ state: 'failure', label: '2 checks', url: 'https://github.com/c/abc123' });
    expect(detail.files.map((file) => file.path)).toEqual(['src/a.ts']);
    expect(detail.commits.map((commit) => commit.message)).toEqual(['Add a thing']);
    expect(detail.capabilities).toEqual({ comment: true, state: true, review: true, merge: true });
  });

  test('a commit status is read when there are no check runs', async () => {
    const { fetchImpl } = host({
      '/repos/kabmo-labs/kabmo/pulls/13': {
        number: 13,
        title: 't',
        state: 'open',
        head: { ref: 'f', sha: 'def456' },
        base: { ref: 'main' },
      },
      '/repos/kabmo-labs/kabmo/issues/13/comments': [],
      '/repos/kabmo-labs/kabmo/commits/def456/check-runs': { check_runs: [] },
      '/repos/kabmo-labs/kabmo/commits/def456/status': { state: 'pending' },
      '/repos/kabmo-labs/kabmo/pulls/13/files': [],
      '/repos/kabmo-labs/kabmo/pulls/13/commits': [],
    });

    const detail = await detailGithub(github(fetchImpl), 'pulls', '13');
    if ('error' in detail) throw new Error(detail.error);
    expect(detail.ci?.state).toBe('pending');
  });

  test('an issue has no review, merge, CI or files', async () => {
    const { fetchImpl } = host({
      '/repos/kabmo-labs/kabmo/issues/9': { number: 9, title: 'An issue', state: 'open', body: 'text', comments: 0 },
      '/repos/kabmo-labs/kabmo/issues/9/comments': [],
    });

    const detail = await detailGithub(github(fetchImpl), 'issues', '9');
    if ('error' in detail) throw new Error(detail.error);
    expect(detail.ci).toBeNull();
    expect(detail.files).toEqual([]);
    expect(detail.capabilities).toEqual({ comment: true, state: true, review: false, merge: false });
  });

  test('a release has no comment thread', async () => {
    const { asked, fetchImpl } = host({
      '/repos/kabmo-labs/kabmo/releases/tags/v1': { tag_name: 'v1', name: 'One', body: 'notes' },
    });

    const detail = await detailGithub(github(fetchImpl), 'releases', 'v1');
    if ('error' in detail) throw new Error(detail.error);
    expect(detail.comments).toEqual([]);
    expect(detail.capabilities).toEqual({ comment: false, state: false, review: false, merge: false });
    expect(asked.some((url) => url.includes('/comments'))).toBe(false);
  });

  test('a failed detail read is a sentence', async () => {
    const { fetchImpl } = host({});
    const detail = await detailGithub(github(fetchImpl), 'issues', '404');
    expect('error' in detail).toBe(true);
  });
});

describe('isBotUser', () => {
  test('an App account and a [bot] login are both bots', () => {
    expect(isBotUser({ login: 'dependabot[bot]', type: 'Bot' })).toBe(true);
    expect(isBotUser({ login: 'renovate[bot]' })).toBe(true);
    expect(isBotUser({ login: 'release-bot' })).toBe(true);
    expect(isBotUser({ login: 'ana', type: 'User' })).toBe(false);
  });
});
