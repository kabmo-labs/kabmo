/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import {
  gitIdentityArgs,
  gitIdentityAuthorArgs,
  isGitIdentity,
  normalizeGitIdentities,
  selectedGitIdentity,
  type GitIdentity,
} from '@/shared/lib/git/identity';

const WORK: GitIdentity = { id: 'work', name: 'Work User', email: 'work@example.invalid' };

describe('isGitIdentity', () => {
  test('accepts a name and an email', () => {
    expect(isGitIdentity(WORK)).toBe(true);
  });

  test('refuses a missing name, a missing email, and a malformed id', () => {
    expect(isGitIdentity({ ...WORK, name: '  ' })).toBe(false);
    expect(isGitIdentity({ ...WORK, email: 'not-an-email' })).toBe(false);
    expect(isGitIdentity({ ...WORK, id: 'has space' })).toBe(false);
  });

  test('refuses angle brackets, which would change the --author address', () => {
    expect(isGitIdentity({ ...WORK, name: 'Work <Admin>' })).toBe(false);
    expect(isGitIdentity({ ...WORK, email: 'work@example.invalid>' })).toBe(false);
  });
});

describe('normalizeGitIdentities', () => {
  test('drops malformed rows and duplicate ids', () => {
    expect(normalizeGitIdentities([
      WORK,
      { ...WORK, name: 'Duplicate' },
      { id: 'bad', name: '', email: 'x@y' },
      { id: 'other', name: 'Other', email: 'other@example.invalid' },
    ])).toEqual([WORK, { id: 'other', name: 'Other', email: 'other@example.invalid' }]);
  });

  test('a non-array is an empty list', () => {
    expect(normalizeGitIdentities(null)).toEqual([]);
    expect(normalizeGitIdentities({})).toEqual([]);
  });
});

describe('selectedGitIdentity', () => {
  test('empty and unknown selections mean repository config', () => {
    expect(selectedGitIdentity([WORK], '')).toBeNull();
    expect(selectedGitIdentity([WORK], 'missing')).toBeNull();
  });

  test('a matching id is the identity', () => {
    expect(selectedGitIdentity([WORK], 'work')).toEqual(WORK);
  });
});

describe('git identity arguments', () => {
  test('no identity adds no flags', () => {
    expect(gitIdentityArgs(null)).toEqual([]);
    expect(gitIdentityAuthorArgs(null)).toEqual([]);
  });

  test('the identity is two -c flags, and an amend names the author', () => {
    expect(gitIdentityArgs(WORK)).toEqual([
      '-c', 'user.name=Work User',
      '-c', 'user.email=work@example.invalid',
    ]);
    expect(gitIdentityAuthorArgs(WORK)).toEqual(['--author', 'Work User <work@example.invalid>']);
  });
});
