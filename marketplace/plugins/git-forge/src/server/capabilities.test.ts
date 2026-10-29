/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The capability table, which is the only thing standing between a read and a
 * button that can only fail.
 */

import { describe, expect, test } from 'bun:test';

import type { CapabilityInput } from './capabilities';
import { capabilitiesFor, writeRefusal } from './capabilities';
import { readOnly } from '../protocol';

const github = (section: CapabilityInput['section'] = 'pulls', hasCredential = true): CapabilityInput => ({
  provider: 'github',
  section,
  hasCredential,
});

describe('capabilitiesFor', () => {
  test('no credential removes everything, because every host refuses an anonymous write', () => {
    expect(capabilitiesFor(github('pulls', false))).toEqual(readOnly());
  });

  test('a pull request with a credential gets all four on GitHub', () => {
    expect(capabilitiesFor(github('pulls'))).toEqual({
      comment: true,
      state: true,
      review: true,
      merge: true,
      mergeMethods: ['merge', 'squash', 'rebase'],
      reviewVerdicts: ['approve', 'request_changes'],
    });
  });

  test('an issue has no review, no merge and no merge styles', () => {
    expect(capabilitiesFor(github('issues'))).toEqual({
      comment: true,
      state: true,
      review: false,
      merge: false,
      mergeMethods: [],
      reviewVerdicts: [],
    });
  });

  test('a release has nothing, even with a credential', () => {
    expect(capabilitiesFor(github('releases'))).toEqual(readOnly());
  });

  test('Bitbucket offers no verdict, because its review endpoints take no message', () => {
    const caps = capabilitiesFor({ provider: 'bitbucket', section: 'pulls', hasCredential: true });
    expect(caps.review).toBe(false);
    expect(caps.reviewVerdicts).toEqual([]);
  });

  test('GitLab offers a review, but only the one verdict the host has', () => {
    const caps = capabilitiesFor({ provider: 'gitlab', section: 'pulls', hasCredential: true });
    expect(caps.review).toBe(true);
    expect(caps.reviewVerdicts).toEqual(['approve']);
    expect(capabilitiesFor({ provider: 'gitea', section: 'pulls', hasCredential: true }).review).toBe(true);
  });

  test('only GitHub and Gitea can merge by rebase', () => {
    const methods = (provider: 'github' | 'gitlab' | 'gitea' | 'bitbucket') =>
      capabilitiesFor({ provider, section: 'pulls', hasCredential: true }).mergeMethods;
    expect(methods('github')).toContain('rebase');
    expect(methods('gitea')).toContain('rebase');
    // GitLab's merge endpoint takes `squash` and nothing else; Bitbucket's
    // fast-forward is not a rebase. Offering either would perform a different
    // operation than the one the confirmation promised.
    expect(methods('gitlab')).toEqual(['merge', 'squash']);
    expect(methods('bitbucket')).toEqual(['merge', 'squash']);
  });
});

describe('writeRefusal', () => {
  test('a missing credential is named, with where to put one', () => {
    const result = writeRefusal({ kind: 'comment', body: 'x' }, github('pulls', false));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('GITHUB_TOKEN');
  });

  test('a release refuses every verb, by name', () => {
    const result = writeRefusal({ kind: 'state', state: 'closed' }, github('releases'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('release');
  });

  test('merging an issue is refused', () => {
    expect(writeRefusal({ kind: 'merge', method: 'squash' }, github('issues')).ok).toBe(false);
  });

  test('GitLab refuses request-changes and says what to do instead', () => {
    const result = writeRefusal(
      { kind: 'review', verdict: 'request_changes', body: '' },
      { provider: 'gitlab', section: 'pulls', hasCredential: true },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('no "request changes" event');
  });

  test('GitLab accepts approve', () => {
    expect(
      writeRefusal(
        { kind: 'review', verdict: 'approve', body: '' },
        { provider: 'gitlab', section: 'pulls', hasCredential: true },
      ).ok,
    ).toBe(true);
  });

  test('Bitbucket refuses a review verdict, because it cannot carry the words', () => {
    const refused = writeRefusal(
      { kind: 'review', verdict: 'approve', body: 'why' },
      { provider: 'bitbucket', section: 'pulls', hasCredential: true },
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toContain('Bitbucket has no review verdict this panel can post');
  });

  test('GitLab refuses a rebase merge by name, and says what it can do', () => {
    const result = writeRefusal(
      { kind: 'merge', method: 'rebase' },
      { provider: 'gitlab', section: 'pulls', hasCredential: true },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('GitLab cannot merge with "rebase"');
    expect(result.reason).toContain('merge or squash');
  });

  test('every ordinary verb is allowed where it is offered', () => {
    for (const write of [
      { kind: 'comment', body: 'x' },
      { kind: 'state', state: 'closed' },
      { kind: 'merge', method: 'squash' },
    ] as const) {
      expect(writeRefusal(write, github('pulls')).ok).toBe(true);
    }
  });
});
