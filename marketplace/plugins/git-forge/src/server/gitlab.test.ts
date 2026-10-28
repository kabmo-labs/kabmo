/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GitLab's adapter, over recorded bodies.
 *
 * Split from the GitHub half because the two vendors disagree on nearly every
 * field, and a single file that carried both made a failure ambiguous. The cases
 * are the ones that silently mislead rather than fail: `opened` instead of
 * `open`, a `changes_count` sent as a STRING, a project whose releases answer
 * 404, and system notes that are an audit trail rather than a reply.
 */

import { describe, expect, test } from 'bun:test';

import type { ForgeContext } from './context';
import { detailGitlab, listGitlab } from './gitlab';
import { host, coldCache } from './test-host';

function context(overrides: Partial<ForgeContext> & { fetchImpl: typeof fetch }): ForgeContext {
  return {
    provider: 'gitlab',
    apiBase: 'https://git-rbi.jatismobile.com/api/v4',
    slug: 'jns6_5/drrealhandler',
    webUrl: 'https://git-rbi.jatismobile.com/jns6_5/drrealhandler',
    host: 'git-rbi.jatismobile.com',
    token: null,
    perPage: 30,
    cache: coldCache(),
    ...overrides,
  };
}

describe('listGitlab', () => {
  test('the project is addressed by its URL-encoded path', async () => {
    const { asked, fetchImpl } = host({});
    await listGitlab(context({ fetchImpl }), 'open');
    expect(asked.every((url) => url.includes('/projects/jns6_5%2Fdrrealhandler/'))).toBe(true);
  });

  test('GitLab says opened, and an open merge request is open', async () => {
    const { fetchImpl } = host({
      '/api/v4/projects/jns6_5%2Fdrrealhandler/merge_requests': [
        { iid: 1, title: 'Open', state: 'opened', author: { username: 'a' } },
        { iid: 2, title: 'Merged', state: 'merged', author: { username: 'a' } },
        { iid: 3, title: 'Draft', state: 'opened', draft: true, author: { username: 'a' } },
      ],
      '/api/v4/projects/jns6_5%2Fdrrealhandler/issues': [],
      '/api/v4/projects/jns6_5%2Fdrrealhandler/releases': [],
    });

    const list = await listGitlab(context({ fetchImpl }), 'open');
    expect(list.sections.pulls.items.map((item) => item.state)).toEqual(['open', 'merged', 'draft']);
  });

  test('the open filter is spelled `opened`', async () => {
    const { asked, fetchImpl } = host({});
    await listGitlab(context({ fetchImpl }), 'open');
    expect(asked.some((url) => url.includes('/issues?state=opened'))).toBe(true);
  });

  test('a project with no releases answers 404, which is an empty section', async () => {
    const { fetchImpl } = host({
      '/api/v4/projects/jns6_5%2Fdrrealhandler/issues': [{ iid: 1, title: 'ok', state: 'opened' }],
      '/api/v4/projects/jns6_5%2Fdrrealhandler/merge_requests': [],
    });

    // A token is set so the anonymous-read note does not mask the assertion:
    // what is under test is that a 404 on releases is silent, not that an
    // anonymous read is.
    const list = await listGitlab(context({ fetchImpl, token: 'glpat-test' }), 'open');
    expect(list.sections.issues.items).toHaveLength(1);
    expect(list.sections.releases.items).toEqual([]);
    expect(list.notes).toEqual([]);
  });

  test('labels arrive as plain strings', async () => {
    const { fetchImpl } = host({
      '/api/v4/projects/jns6_5%2Fdrrealhandler/issues': [
        { iid: 1, title: 't', state: 'opened', labels: ['bug', 'p1'] },
      ],
      '/api/v4/projects/jns6_5%2Fdrrealhandler/merge_requests': [],
      '/api/v4/projects/jns6_5%2Fdrrealhandler/releases': [],
    });

    const list = await listGitlab(context({ fetchImpl }), 'open');
    expect(list.sections.issues.items[0].labels).toEqual([
      { name: 'bug', color: null },
      { name: 'p1', color: null },
    ]);
  });
});

describe('detailGitlab', () => {
  /** A different project, so the detail URLs below are the ones under test. */
  const detailContext = (fetchImpl: typeof fetch): ForgeContext =>
    context({ fetchImpl, apiBase: 'https://gitlab.com/api/v4', slug: 'group/project', host: 'gitlab.com' });

  test('system notes are not part of the conversation', async () => {
    const { fetchImpl } = host({
      '/api/v4/projects/group%2Fproject/merge_requests/5': {
        iid: 5,
        title: 'A change',
        state: 'opened',
        description: 'Body text',
        source_branch: 'feat',
        target_branch: 'main',
        changes_count: '3',
        detailed_merge_status: 'mergeable',
      },
      '/api/v4/projects/group%2Fproject/merge_requests/5/notes': [
        { id: 1, author: { username: 'ana' }, body: 'Real comment', created_at: '2026-01-01' },
        { id: 2, author: { username: 'ana' }, body: 'changed the description', system: true },
      ],
    });

    const detail = await detailGitlab(detailContext(fetchImpl), 'pulls', '5');
    if ('error' in detail) throw new Error(detail.error);
    expect(detail.comments.map((comment) => comment.body)).toEqual(['Real comment']);
    expect(detail.facts).toEqual([
      { label: 'branch', value: 'main ← feat' },
      { label: 'files', value: '3' },
      { label: 'mergeable', value: 'yes' },
    ]);
  });

  test('a conflicting merge request says conflicts, not no', async () => {
    const { fetchImpl } = host({
      '/api/v4/projects/group%2Fproject/merge_requests/5': {
        iid: 5,
        title: 't',
        state: 'opened',
        has_conflicts: true,
      },
      '/api/v4/projects/group%2Fproject/merge_requests/5/notes': [],
    });

    const detail = await detailGitlab(detailContext(fetchImpl), 'pulls', '5');
    if ('error' in detail) throw new Error(detail.error);
    expect(detail.facts).toContainEqual({ label: 'mergeable', value: 'conflicts' });
  });
});
