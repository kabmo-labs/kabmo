/**
 * @license
 * SPDX-License-Identifier: MIT
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

import { listGitlab, mergeState, projectPath } from './gitlab';
import { detailGitlab } from './gitlab-detail';
import { host } from './test-host';
import { hostContext, openFilter } from './test-context';

const gitlab = (fetchImpl: typeof fetch, overrides: Parameters<typeof hostContext>[2] = {}) =>
  hostContext('gitlab', fetchImpl, overrides);

/** The URL-encoded project every read is built on. */
const PROJECT = '/api/v4/projects/group%2Fproject';

describe('listGitlab', () => {
  test('the project is addressed by its URL-encoded path', async () => {
    const { asked, fetchImpl } = host({});
    await listGitlab(gitlab(fetchImpl));
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((url) => url.includes('/projects/group%2Fproject/'))).toBe(true);
  });

  test('GitLab says opened, and an open merge request is open', async () => {
    const { fetchImpl } = host({
      [`${PROJECT}/merge_requests`]: [
        { iid: 1, title: 'Open', state: 'opened', author: { username: 'a' } },
        { iid: 2, title: 'Merged', state: 'merged', author: { username: 'a' } },
        { iid: 3, title: 'Draft', state: 'opened', draft: true, author: { username: 'a' } },
      ],
      [`${PROJECT}/issues`]: [],
      [`${PROJECT}/releases`]: [],
    });

    const list = await listGitlab(gitlab(fetchImpl));
    expect(list.sections.pulls.items.map((item) => item.state)).toEqual(['open', 'merged', 'draft']);
  });

  test('the open filter is spelled `opened`, and mine is a scope', async () => {
    const { asked, fetchImpl } = host({});
    await listGitlab(gitlab(fetchImpl, { filter: { ...openFilter(), mine: true } }));
    const issues = asked.find((url) => url.includes('/issues'));
    expect(issues).toContain('state=opened');
    expect(issues).toContain('scope=assigned_to_me');
    // Sending both is a 400 on GitLab, so the builder must never emit both.
    expect(issues).not.toContain('assignee_username');
  });

  test('a project with no releases answers 404, which is an empty section', async () => {
    const { fetchImpl } = host({
      [`${PROJECT}/issues`]: [{ iid: 1, title: 'ok', state: 'opened' }],
      [`${PROJECT}/merge_requests`]: [],
    });

    const list = await listGitlab(gitlab(fetchImpl));
    expect(list.sections.issues.items).toHaveLength(1);
    expect(list.sections.releases.items).toEqual([]);
    expect(list.notes).toEqual([]);
  });

  test('labels arrive as plain strings', async () => {
    const { fetchImpl } = host({
      [`${PROJECT}/issues`]: [{ iid: 1, title: 't', state: 'opened', labels: ['bug', 'p1'] }],
      [`${PROJECT}/merge_requests`]: [],
      [`${PROJECT}/releases`]: [],
    });

    const list = await listGitlab(gitlab(fetchImpl));
    expect(list.sections.issues.items[0].labels).toEqual([
      { name: 'bug', color: null },
      { name: 'p1', color: null },
    ]);
  });
});

describe('mergeState', () => {
  test('the word decides, not a merged_at field GitLab does not send', () => {
    expect(mergeState({ state: 'merged' })).toBe('merged');
    expect(mergeState({ state: 'closed' })).toBe('closed');
    expect(mergeState({ state: 'opened' })).toBe('open');
    expect(mergeState({ state: 'opened', draft: true })).toBe('draft');
    expect(mergeState({ state: 'opened', work_in_progress: true })).toBe('draft');
  });
});

describe('detailGitlab', () => {
  test('system notes are kept and flagged, not dropped', async () => {
    const { fetchImpl } = host({
      [`${PROJECT}/merge_requests/5`]: {
        iid: 5,
        title: 'A change',
        state: 'opened',
        description: 'Body text',
        source_branch: 'feat',
        target_branch: 'main',
        changes_count: '3',
        detailed_merge_status: 'mergeable',
        head_pipeline: { status: 'failed', web_url: 'https://gitlab/p/1' },
        // The files are NOT here: measured on a real project, the detail carries
        // `changes_count` and no `changes` array.
      },
      [`${PROJECT}/merge_requests/5/changes`]: {
        iid: 5,
        changes: [
          { old_path: 'src/a.ts', new_path: 'src/a.ts', diff: '@@ -1 +1 @@' },
          { old_path: 'new.ts', new_path: 'new.ts', new_file: true, diff: '@@ -0,0 +1 @@' },
        ],
      },
      [`${PROJECT}/merge_requests/5/notes`]: [
        { id: 1, author: { username: 'ana' }, body: 'Real comment', created_at: '2026-01-01' },
        { id: 2, author: { username: 'ana' }, body: 'changed the description', system: true },
      ],
      [`${PROJECT}/merge_requests/5/commits`]: [
        { id: 'abc', title: 'A commit', author_name: 'Ana', authored_date: '2026-01-01' },
      ],
    });

    const detail = await detailGitlab(gitlab(fetchImpl), 'pulls', '5');
    if ('error' in detail) throw new Error(detail.error);

    expect(detail.comments.map((comment) => comment.body)).toEqual(['Real comment', 'changed the description']);
    expect(detail.comments.map((comment) => comment.system)).toEqual([false, true]);
    expect(detail.facts).toEqual([
      { label: 'branch', value: 'main ← feat' },
      { label: 'files', value: '3' },
      { label: 'mergeable', value: 'yes' },
    ]);
    expect(detail.ci).toEqual({ state: 'failure', label: 'failed', url: 'https://gitlab/p/1' });
    expect(detail.files.map((file) => [file.path, file.status])).toEqual([
      ['src/a.ts', 'modified'],
      ['new.ts', 'added'],
    ]);
    expect(detail.commits.map((commit) => commit.message)).toEqual(['A commit']);
  });

  test('the files come from the /changes sub-resource, because the detail carries none', async () => {
    const { fetchImpl } = host({
      [`${PROJECT}/merge_requests/8`]: { iid: 8, title: 't', state: 'opened', changes_count: '15' },
      [`${PROJECT}/merge_requests/8/notes`]: [],
      [`${PROJECT}/merge_requests/8/commits`]: [],
      [`${PROJECT}/merge_requests/8/changes`]: {
        changes: [{ old_path: 'a.ts', new_path: 'a.ts', diff: '@@ -1 +1 @@' }],
      },
    });

    const detail = await detailGitlab(gitlab(fetchImpl), 'pulls', '8');
    if ('error' in detail) throw new Error(detail.error);
    expect(detail.files.map((file) => file.path)).toEqual(['a.ts']);
  });

  test('a conflicting merge request says conflicts, not no', async () => {
    const { fetchImpl } = host({
      [`${PROJECT}/merge_requests/6`]: { iid: 6, title: 't', state: 'opened', has_conflicts: true },
      [`${PROJECT}/merge_requests/6/notes`]: [],
      [`${PROJECT}/merge_requests/6/commits`]: [],
      [`${PROJECT}/merge_requests/6/changes`]: { changes: [] },
    });

    const detail = await detailGitlab(gitlab(fetchImpl), 'pulls', '6');
    if ('error' in detail) throw new Error(detail.error);
    expect(detail.facts).toContainEqual({ label: 'mergeable', value: 'conflicts' });
  });

  test('an issue has no files, no pipeline and no merge', async () => {
    const { fetchImpl } = host({
      [`${PROJECT}/issues/7`]: { iid: 7, title: 't', state: 'opened', description: 'x' },
      [`${PROJECT}/issues/7/notes`]: [],
    });

    const detail = await detailGitlab(gitlab(fetchImpl), 'issues', '7');
    if ('error' in detail) throw new Error(detail.error);
    expect(detail.files).toEqual([]);
    expect(detail.ci).toBeNull();
    expect(detail.capabilities).toEqual({ comment: true, state: true, review: false, merge: false });
  });
});

describe('projectPath', () => {
  test('a subgroup is encoded as one path segment', () => {
    expect(projectPath(gitlab(fetch as unknown as typeof fetch, { slug: 'a/b/c' }))).toBe('projects/a%2Fb%2Fc');
  });
});
