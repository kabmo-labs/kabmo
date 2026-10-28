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

const github = (section: CapabilityInput['section'] = 'pulls', hasCredential = true): CapabilityInput => ({
  provider: 'github',
  section,
  hasCredential,
});

describe('capabilitiesFor', () => {
  test('no credential removes everything, because every host refuses an anonymous write', () => {
    expect(capabilitiesFor(github('pulls', false))).toEqual({
      comment: false,
      state: false,
      review: false,
      merge: false,
    });
  });

  test('a pull request with a credential gets all four on GitHub', () => {
    expect(capabilitiesFor(github('pulls'))).toEqual({ comment: true, state: true, review: true, merge: true });
  });

  test('an issue has no review and no merge', () => {
    expect(capabilitiesFor(github('issues'))).toEqual({ comment: true, state: true, review: false, merge: false });
  });

  test('a release has nothing, even with a credential', () => {
    expect(capabilitiesFor(github('releases'))).toEqual({
      comment: false,
      state: false,
      review: false,
      merge: false,
    });
  });

  test('Bitbucket has no review verdict', () => {
    expect(capabilitiesFor({ provider: 'bitbucket', section: 'pulls', hasCredential: true }).review).toBe(false);
  });

  test('GitLab and Gitea both offer a review on a merge request', () => {
    expect(capabilitiesFor({ provider: 'gitlab', section: 'pulls', hasCredential: true }).review).toBe(true);
    expect(capabilitiesFor({ provider: 'gitea', section: 'pulls', hasCredential: true }).review).toBe(true);
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
    expect(result.reason).toContain('no "request changes"');
  });

  test('GitLab accepts approve', () => {
    expect(
      writeRefusal(
        { kind: 'review', verdict: 'approve', body: '' },
        { provider: 'gitlab', section: 'pulls', hasCredential: true },
      ).ok,
    ).toBe(true);
  });

  test('Bitbucket refuses a review verdict', () => {
    const result = writeRefusal(
      { kind: 'review', verdict: 'approve', body: '' },
      { provider: 'bitbucket', section: 'pulls', hasCredential: true },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('no review verdict');
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
