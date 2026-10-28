/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Gitea / Forgejo and Bitbucket, over recorded bodies.
 *
 * Two hosts in one file because they share the tests that matter most here —
 * both answer a pull request's diff as TEXT, so both go through the shared
 * parser, and a regression in it would otherwise be found twice.
 *
 * The cases are the ones that differ from the two big hosts:
 *
 * - **Gitea puts issues and pull requests on ONE endpoint**, split by `type`,
 *   and a pull request appears in the issues response as well.
 * - **Gitea's `state=all` is spelled `all`** — sending `open,closed` matches
 *   nothing.
 * - **Bitbucket wraps every collection in `{values, next, size}`**, never a bare
 *   array, and spells its states in uppercase.
 * - **Bitbucket has no `draft` flag**, and a declined pull request is `closed`
 *   rather than `merged`.
 */

import { describe, expect, test } from 'bun:test';

import { bitbucketState, detailBitbucket, listBitbucket } from './bitbucket';
import { detailGitea, giteaPullState, listGitea } from './gitea';
import { host } from './test-host';
import { hostContext, openFilter } from './test-context';

const gitea = (fetchImpl: typeof fetch, overrides: Parameters<typeof hostContext>[2] = {}) =>
  hostContext('gitea', fetchImpl, overrides);
const bitbucket = (fetchImpl: typeof fetch, overrides: Parameters<typeof hostContext>[2] = {}) =>
  hostContext('bitbucket', fetchImpl, overrides);

describe('listGitea', () => {
  test('the section becomes a type parameter on ONE endpoint', async () => {
    const { asked, fetchImpl } = host({});
    await listGitea(gitea(fetchImpl));
    const issueReads = asked.filter((url) => url.includes('/repos/team/app/issues'));
    expect(issueReads.some((url) => url.includes('type=issues'))).toBe(true);
    expect(issueReads.some((url) => url.includes('type=pulls'))).toBe(true);
    // There is no separate `/pulls` collection for listing.
    expect(asked.some((url) => url.includes('/repos/team/app/pulls?'))).toBe(false);
  });

  test('a pull request in the issues response is not an issue', async () => {
    const { fetchImpl } = host({
      '/api/v1/repos/team/app/issues': [
        { number: 1, title: 'Real issue', state: 'open', user: { login: 'ana' } },
        { number: 2, title: 'A PR', state: 'open', user: { login: 'bo' }, pull_request: { merged: false } },
      ],
      '/api/v1/repos/team/app/releases': [],
    });

    const list = await listGitea(gitea(fetchImpl));
    // Both sections read the same endpoint, so the filter is what separates them.
    expect(list.sections.issues.items.map((item) => item.number)).toEqual([1]);
  });

  test('the filter rides as parameters, and mine is assigned=true', async () => {
    const { asked, fetchImpl } = host({});
    await listGitea(gitea(fetchImpl, { filter: { ...openFilter(), mine: true, label: 'bug', query: 'crash' } }));
    const read = asked.find((url) => url.includes('type=issues'));
    expect(read).toContain('assigned=true');
    expect(read).toContain('labels=bug');
    expect(read).toContain('q=crash');
    expect(read).toContain('state=open');
  });

  test('a repository with no releases answers 404, which is an empty section', async () => {
    const { fetchImpl } = host({
      '/api/v1/repos/team/app/issues': [{ number: 1, title: 'ok', state: 'open' }],
    });

    const list = await listGitea(gitea(fetchImpl));
    expect(list.sections.releases.items).toEqual([]);
    expect(list.notes).toEqual([]);
  });
});

describe('giteaPullState', () => {
  test('merged is on the pull object or nested in the issue row', () => {
    expect(giteaPullState({ state: 'closed', merged: true })).toBe('merged');
    expect(giteaPullState({ state: 'closed', pull_request: { merged_at: '2026-01-01' } })).toBe('merged');
    expect(giteaPullState({ state: 'closed' })).toBe('closed');
    expect(giteaPullState({ state: 'open' })).toBe('open');
  });
});

describe('detailGitea', () => {
  test('the files come from the diff TEXT, through the shared parser', async () => {
    const diff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,2 @@
 one
+two
`;
    const { fetchImpl } = host({
      '/api/v1/repos/team/app/pulls/4': {
        number: 4,
        title: 'A change',
        state: 'open',
        body: 'Body',
        head: { ref: 'feat' },
        base: { ref: 'main' },
      },
      '/api/v1/repos/team/app/issues/4/comments': [
        { id: 1, user: { login: 'ana' }, body: 'Nice', created_at: '2026-01-01' },
      ],
      '/api/v1/repos/team/app/pulls/4/commits': [
        { sha: 'abc', commit: { message: 'One commit\n\nbody', author: { name: 'Ana', date: '2026-01-01' } } },
      ],
    });
    // The diff route answers TEXT, and the shared fake host sends JSON — so it is
    // stubbed here, which is also what proves the adapter handles a string.
    const withDiff = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('.diff')) return new Response(diff, { status: 200 });
      return fetchImpl(input, init);
    }) as typeof fetch;

    const detail = await detailGitea(gitea(withDiff), 'pulls', '4');
    if ('error' in detail) throw new Error(detail.error);

    expect(detail.files.map((file) => [file.path, file.additions])).toEqual([['src/a.ts', 1]]);
    expect(detail.facts).toContainEqual({ label: 'branch', value: 'main ← feat' });
    expect(detail.commits.map((commit) => commit.message)).toEqual(['One commit']);
    expect(detail.capabilities.review).toBe(true);
  });
});

describe('bitbucketState', () => {
  test('three closed words collapse to closed; merged is its own state', () => {
    expect(bitbucketState('MERGED')).toBe('merged');
    expect(bitbucketState('DECLINED')).toBe('closed');
    expect(bitbucketState('SUPERSEDED')).toBe('closed');
    expect(bitbucketState('OPEN')).toBe('open');
  });
});

describe('listBitbucket', () => {
  test('every collection is a paged envelope, never a bare array', async () => {
    const { fetchImpl } = host({
      '/2.0/repositories/team/app/pullrequests': {
        size: 2,
        values: [
          { id: 1, title: 'Open one', state: 'OPEN', author: { nickname: 'ana' }, links: { html: { href: 'u1' } } },
          { id: 2, title: 'Declined', state: 'DECLINED', author: { nickname: 'bo' }, links: { html: { href: 'u2' } } },
        ],
      },
      '/2.0/repositories/team/app/issues': {
        size: 1,
        values: [{ id: 9, title: 'An issue', state: 'new', reporter: { nickname: 'ana' }, links: { html: { href: 'u9' } } }],
      },
      '/2.0/repositories/team/app/refs/tags': { size: 0, values: [] },
    });

    const list = await listBitbucket(bitbucket(fetchImpl));
    expect(list.sections.pulls.items.map((item) => item.state)).toEqual(['open', 'closed']);
    expect(list.sections.issues.items[0].state).toBe('open');
    // The envelope's own `size` is the total, which is what makes a truncation
    // report honest.
    expect(list.sections.pulls.total).toBe(2);
  });

  test('the filter becomes a BBQL query, because there is no parameter for it', async () => {
    const { asked, fetchImpl } = host({});
    await listBitbucket(bitbucket(fetchImpl, { filter: { ...openFilter(), state: 'closed', label: 'bug' } }));
    const read = asked.find((url) => url.includes('/pullrequests'));
    // `URLSearchParams` encodes a space as `+`, so the query is decoded the way
    // a reader of the URL would decode it.
    const query = decodeURIComponent((read ?? '').replace(/\+/g, ' '));
    expect(query).toContain('state="MERGED"');
    expect(query).toContain('labels ~ "bug"');
  });

  test('a nested slug is refused by name rather than read as another project', async () => {
    const { fetchImpl } = host({});
    const list = await listBitbucket(bitbucket(fetchImpl, { slug: 'a/b/c' }));
    expect(list.sections.issues.items).toEqual([]);
    expect(list.notes.join(' ')).toContain('workspace/repo');
  });
});

describe('detailBitbucket', () => {
  test('the description is content.raw, and the diff is text', async () => {
    const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1,2 @@
-x
+y
+z
`;
    const { fetchImpl } = host({
      '/2.0/repositories/team/app/pullrequests/5': {
        id: 5,
        title: 'A change',
        state: 'OPEN',
        content: { raw: 'Body text' },
        source: { branch: { name: 'feat' } },
        destination: { branch: { name: 'main' } },
        reviewers: [{ nickname: 'a' }, { nickname: 'b' }],
        links: { html: { href: 'u5' } },
      },
      '/2.0/repositories/team/app/pullrequests/5/comments': {
        values: [
          { id: 1, user: { nickname: 'ana' }, content: { raw: 'Nice' }, created_on: '2026-01-01' },
          { id: 2, user: { nickname: 'x' }, content: { raw: 'gone' }, deleted: true },
        ],
      },
      '/2.0/repositories/team/app/pullrequests/5/commits': {
        values: [{ hash: 'abc', message: 'One commit', author: { raw: 'Ana <ana@example.com>' }, date: '2026-01-01' }],
      },
    });
    const withDiff = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/diff')) return new Response(diff, { status: 200 });
      return fetchImpl(input, init);
    }) as typeof fetch;

    const detail = await detailBitbucket(bitbucket(withDiff), 'pulls', '5');
    if ('error' in detail) throw new Error(detail.error);

    expect(detail.body).toBe('Body text');
    expect(detail.facts).toContainEqual({ label: 'branch', value: 'main ← feat' });
    expect(detail.facts).toContainEqual({ label: 'reviewers', value: '2' });
    // A deleted comment keeps its row in the envelope and is not a reply.
    expect(detail.comments.map((comment) => comment.body)).toEqual(['Nice']);
    expect(detail.files[0]).toMatchObject({ path: 'a.ts', additions: 2, deletions: 1 });
    expect(detail.commits[0].author).toBe('Ana');
    expect(detail.capabilities.review).toBe(false);
  });
});
