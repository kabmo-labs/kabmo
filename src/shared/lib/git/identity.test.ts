/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import {
  isGitIdentity,
  normalizeGitIdentities,
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

  test('refuses angle brackets, which would change the author address', () => {
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
