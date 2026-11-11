/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The panel's presentation helpers.
 *
 * These are the facts a row and a sidebar draw, and each has a wrong answer that
 * looks plausible: a failed read drawn as `0`, a truncated page drawn as a
 * complete one, a vendor word that does not follow the provider. The tests pin
 * the three count answers and the one vendor difference a reader sees.
 */

import { describe, expect, test } from 'bun:test';

import { countLabel, countTitle, fullTime, itemIdLabel, providerLabel, relativeTime, sectionLabel, sectionShort } from './format';
import { section } from './test-fixtures';

describe('countLabel', () => {
  test('a count is the number of rows', () => {
    expect(countLabel(section({ items: [], total: 0 }))).toBe('0');
  });

  test('a full page is marked with a plus', () => {
    expect(countLabel(section({ items: [], truncated: true }))).toBe('0+');
  });

  test('a failed read is never a zero', () => {
    expect(countLabel(section({ failed: true }))).toBe('!');
  });

  test('no data yet is an empty string, not a zero', () => {
    expect(countLabel(undefined)).toBe('');
  });
});

describe('countTitle', () => {
  test('a failed read names the failure', () => {
    expect(countTitle(section({ failed: true }))).toContain('could not be read');
  });

  test('a truncated page says how many are shown', () => {
    expect(countTitle(section({ items: [], truncated: true }))).toContain('full page');
  });

  test('a count is singular for one item', () => {
    expect(countTitle(section({ items: [], total: 1 }))).toBe('0 items');
  });
});

describe('providerLabel', () => {
  test('every provider has a display name', () => {
    expect(providerLabel('github')).toBe('GitHub');
    expect(providerLabel('gitlab')).toBe('GitLab');
    expect(providerLabel('gitea')).toBe('Gitea');
    expect(providerLabel('bitbucket')).toBe('Bitbucket');
  });
});

describe('sectionLabel', () => {
  test('the change section follows the provider', () => {
    expect(sectionLabel('pulls', 'github')).toBe('Pull requests');
    expect(sectionLabel('pulls', 'gitlab')).toBe('Merge requests');
    expect(sectionShort('pulls', 'gitlab')).toBe('MRs');
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-01-10T12:00:00Z');

  test('a fresh timestamp is now', () => {
    expect(relativeTime('2026-01-10T11:59:30Z', now)).toBe('now');
  });

  test('minutes, hours, days and weeks are compact', () => {
    expect(relativeTime('2026-01-10T11:55:00Z', now)).toBe('5m');
    expect(relativeTime('2026-01-10T09:00:00Z', now)).toBe('3h');
    expect(relativeTime('2026-01-08T12:00:00Z', now)).toBe('2d');
    expect(relativeTime('2026-01-01T12:00:00Z', now)).toBe('1w');
  });

  test('an unreadable timestamp is empty rather than NaN', () => {
    expect(relativeTime('not a date', now)).toBe('');
  });
});

describe('itemIdLabel', () => {
  test('an issue is its number, a release is its tag', () => {
    expect(itemIdLabel({ number: 12, tag: null })).toBe('#12');
    expect(itemIdLabel({ number: null, tag: 'v1.2.0' })).toBe('v1.2.0');
  });
});

describe('fullTime', () => {
  test('an unreadable timestamp is empty', () => {
    expect(fullTime('not a date')).toBe('');
  });
});
