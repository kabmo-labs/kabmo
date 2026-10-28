/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `isGitUrl` / `repoSlug` moved here from `lib/panels/install.server.ts` when
 * the New Workspace modal's Clone button began sharing them — the button's
 * enabled state and the server's refusal read the same predicate or they can
 * disagree. The URL forms are the ones `git clone` accepts, verified against
 * git itself rather than assumed.
 */

import { describe, expect, test } from 'bun:test';
import { isGitUrl, repoSlug } from '@/shared/lib/git/url';

describe('isGitUrl', () => {
  test('accepts the three forms git clone understands', () => {
    expect(isGitUrl('https://github.com/a/b.git')).toBe(true);
    expect(isGitUrl('ssh://git@host/a/b.git')).toBe(true);
    expect(isGitUrl('git@github.com:a/b.git')).toBe(true);
  });

  test('accepts a local path and a file:// URL, which git clone also accepts', () => {
    expect(isGitUrl('/tmp/repo')).toBe(true);
    expect(isGitUrl('~/repos/panel')).toBe(true);
    expect(isGitUrl('file:///tmp/repo')).toBe(true);
  });

  test('accepts a Windows local path, drive-rooted and UNC', () => {
    // A local clone from disk is the documented behaviour, and on Windows the
    // spelling of "a path on disk" is a drive letter. Without this the Clone
    // button could never enable there and the route refused a repository the
    // user had just browsed to (measured: all four clone cases failed with 400).
    expect(isGitUrl('C:\\Users\\x\\repo')).toBe(true);
    expect(isGitUrl('C:/Users/x/repo')).toBe(true);
    expect(isGitUrl('d:\\repo')).toBe(true);
    expect(isGitUrl('\\\\server\\share\\repo')).toBe(true);
  });

  test('refuses a drive-RELATIVE path, which is not a location on disk', () => {
    // `C:repo` means "the current directory on drive C", not `C:\repo` — the
    // same distinction `isAbsolutePath` makes in the CLI's path helpers.
    expect(isGitUrl('C:repo')).toBe(false);
  });

  test('refuses a bare name, an empty string and one with whitespace', () => {
    expect(isGitUrl('some-plugin')).toBe(false);
    expect(isGitUrl('   ')).toBe(false);
    expect(isGitUrl('https://a b/c')).toBe(false);
  });
});

describe('repoSlug', () => {
  test('takes the last segment, which is what git clone names the directory', () => {
    expect(repoSlug('https://github.com/kabmo-labs/kabmo.git')).toBe('kabmo');
    expect(repoSlug('git@github.com:kabmo-labs/kabmo.git')).toBe('kabmo');
    expect(repoSlug('https://github.com/a/b/')).toBe('b');
  });

  test('strips the .git suffix and keeps a scp-form path readable', () => {
    expect(repoSlug('/tmp/repo.git')).toBe('repo');
    expect(repoSlug('ssh://git@host:2222/a/b.git')).toBe('b');
  });

  test('returns an empty string when the URL names no segment', () => {
    expect(repoSlug('https://')).toBe('');
  });
});
