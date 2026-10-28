/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The repo scope the kit hands a plugin, as the HOST resolves it.
 *
 * `resolveRepoScope` is pure and this file drives it directly: the rules it owns
 * are the two a plugin would otherwise have to re-derive, and both are wrong in
 * a way that is invisible until a specific state is reached.
 *
 * - **A pick made under ANOTHER root is not this root's pick.** The slot is per
 *   session, so a session that picked `projects/a` and was then pointed at a
 *   different workspace still holds the old `{ root, repo }` pair. A bare read
 *   hands the plugin a path that does not exist under the root it is describing,
 *   and the server then refuses the request with no explanation a user can act
 *   on. The fallback is the workspace root.
 * - **No workspace is `root: null`, never `root: ''`.** An empty string is a
 *   REAL value to a server that resolves it against its own cwd, so a plugin that
 *   passed it through would silently scope a command to Kabmo's own
 *   directory instead of reporting "no workspace".
 *
 * The labels are asserted here too, because they travel with the rows and the
 * naming rule is the host's: the root reads as its folder's name, a list row
 * keeps its whole root-relative path, and the trigger form is the last segment.
 */

import { describe, expect, test } from 'bun:test';
import { resolveRepoScope } from '@/client/lib/plugins/repo-scope-service';

const ROOT = '/ws/Workspace';

describe('resolveRepoScope', () => {
  test('no workspace is a null root, not an empty one', () => {
    const scope = resolveRepoScope(null, null, ['.'], false);
    expect(scope.root).toBeNull();
    // Not `ready`: a picker should hold rather than draw a list it cannot apply.
    expect(scope.ready).toBe(false);
    expect(scope.rows).toEqual([]);
  });

  test('an empty root string is treated as no workspace', () => {
    // The dangerous case: `''` reaches a server that resolves it to its own cwd.
    expect(resolveRepoScope('', null, ['.'], false).root).toBeNull();
  });

  test('labels the root row with the workspace folder name', () => {
    const scope = resolveRepoScope(ROOT, null, ['.'], false);
    expect(scope.repo).toBe('.');
    expect(scope.rows[0]).toEqual({ repo: '.', label: 'Workspace', short: 'Workspace' });
  });

  test('a list row keeps its whole path; the trigger truncates to the last segment', () => {
    const scope = resolveRepoScope(ROOT, null, ['.', 'projects/a/token'], false);
    const row = scope.rows.find((entry) => entry.repo === 'projects/a/token');
    // The list is where `jns6_5/token` and `jns7/token` have to be told apart.
    expect(row?.label).toBe('projects/a/token');
    expect(row?.short).toBe('token');
  });

  test('the root row leads whatever order discovery returned', () => {
    const scope = resolveRepoScope(ROOT, null, ['projects/a', '.', 'zzz'], false);
    expect(scope.rows.map((row) => row.repo)).toEqual(['.', 'projects/a', 'zzz']);
  });

  test('a pick made under this root is reported', () => {
    const scope = resolveRepoScope(ROOT, { root: ROOT, repo: 'projects/a' }, ['.', 'projects/a'], false);
    expect(scope.repo).toBe('projects/a');
  });

  test('a pick made under ANOTHER root falls back to the workspace root', () => {
    const scope = resolveRepoScope(ROOT, { root: '/ws/Other', repo: 'projects/a' }, ['.'], false);
    expect(scope.repo).toBe('.');
  });

  test('a malformed stored pick falls back rather than leaking a bad value', () => {
    // A blob written by an older build, or hand-edited: none of these may reach
    // a request as a repo.
    expect(resolveRepoScope(ROOT, { root: ROOT, repo: '' }, ['.'], false).repo).toBe('.');
    expect(resolveRepoScope(ROOT, { root: ROOT } as never, ['.'], false).repo).toBe('.');
    expect(resolveRepoScope(ROOT, 'projects/a' as never, ['.'], false).repo).toBe('.');
  });

  test('discovery state is carried through, so the picker can spin', () => {
    const scope = resolveRepoScope(ROOT, null, ['.'], true);
    expect(scope.scanning).toBe(true);
    expect(scope.ready).toBe(true);
  });
});
