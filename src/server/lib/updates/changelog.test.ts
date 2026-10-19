/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The release range behind the "What's new" popup: the section parser that reads
 * it out of the repository's `CHANGELOG.md`, and the range/cap math that decides
 * what a user actually sees.
 *
 * The parser is pinned against the real heading spellings — `## [3.14.0](compare)
 * — 2026-10-04`, the older `## [0.5.0] — 2026-09-21`, a plain `## v3.13.0` — plus
 * the `[0.5.0]: https://…` reference block the file ends with, which is a link
 * definition and must not read as the last section's body.
 *
 * The range rules are the ones a real repository exercises: a version behind by
 * one release, by many, a dev build that is not in the list, and a local build
 * newer than the published one. A release equal to the installed version must NOT
 * appear (that is the "already current" decision), a release newer than the
 * published `latest` must not either, and the caps must trim the OLDEST sections
 * while never emptying the list — "showing 12 of 29" is only honest if the newest
 * are the ones kept.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { MAX_NOTES_BYTES, MAX_VERSIONS, capReleaseNotes, selectReleaseRange } from '@/server/lib/updates/changelog';
import { CHANGELOG_URL, fetchChangelogNotes, parseChangelogSections } from '@/server/lib/updates/changelog-file';
import { releaseTagUrl } from '@/server/lib/updates/release-url';
import type { ReleaseNote } from '@/shared/types/updates';

/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const originalFetch = Bun.fetch;

const note = (version: string, body = '', date: string | null = null): ReleaseNote => ({
  version,
  date,
  url: releaseTagUrl(version),
  body,
});

/** A changelog fixture shaped like the repository's own file. */
const CHANGELOG = [
  '# Changelog',
  '',
  'All notable changes to Kabmo are documented in this file.',
  '',
  '## [3.14.0](https://github.com/kabmo-labs/kabmo/compare/v3.13.1...v3.14.0) — 2026-10-04',
  '',
  '### Added',
  '',
  '* **agent:** route a peer-owned session through its instance',
  '',
  '### Fixed',
  '',
  '* **chat:** stop listing a sent turn twice in the timeline rail',
  '',
  '## [3.13.1](https://github.com/kabmo-labs/kabmo/compare/v3.13.0...v3.13.1) — 2026-10-03',
  '',
  '### Fixed',
  '',
  '* **sidebar:** stop the run spinner and name a new session at send time',
  '',
  '## v3.13.0',
  '',
  'A heading without a compare link or a date.',
  '',
  '[3.14.0]: https://github.com/kabmo-labs/kabmo/compare/v3.13.1...v3.14.0',
  '[3.13.1]: https://github.com/kabmo-labs/kabmo/compare/v3.13.0...v3.13.1',
  '',
].join('\n');

describe('parseChangelogSections', () => {
  test('reads each release heading with its date and body', () => {
    const notes = parseChangelogSections(CHANGELOG);
    expect(notes.map((entry) => entry.version)).toEqual(['3.14.0', '3.13.1', '3.13.0']);
    expect(notes[0]!.date).toBe('2026-10-04');
    expect(notes[0]!.body).toBe('### Added\n\n* **agent:** route a peer-owned session through its instance\n\n### Fixed\n\n* **chat:** stop listing a sent turn twice in the timeline rail');
    expect(notes[0]!.url).toBe('https://github.com/kabmo-labs/kabmo/releases/tag/v3.14.0');
  });

  test('accepts a plain heading with neither link nor date', () => {
    const notes = parseChangelogSections(CHANGELOG);
    expect(notes[2]).toMatchObject({ version: '3.13.0', date: null, body: 'A heading without a compare link or a date.' });
  });

  test('the tail reference block is not body text', () => {
    // `[3.14.0]: https://…` is a link definition, not notes; without the guard
    // it rendered as the last section's body.
    const notes = parseChangelogSections(CHANGELOG);
    expect(notes[2]!.body).not.toContain('[3.13.1]:');
  });

  test('a file with no release sections yields nothing', () => {
    expect(parseChangelogSections('# Changelog\n\nProse only.\n')).toEqual([]);
  });

  test('an empty section is kept — a version shipped without notes is still a version', () => {
    const notes = parseChangelogSections('## [1.0.0] — 2026-01-01\n\n## [0.9.0] — 2025-12-01\n\n* something\n');
    expect(notes.map((entry) => entry.version)).toEqual(['1.0.0', '0.9.0']);
    expect(notes[0]!.body).toBe('');
  });
});

describe('fetchChangelogNotes', () => {
  let urls: string[] = [];
  let body = CHANGELOG;
  let status = 200;

  beforeEach(() => {
    delete (globalThis as typeof globalThis & { __ompChamberChangelogCache?: unknown }).__ompChamberChangelogCache;
    urls = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(body, { status, headers: { 'content-type': 'text/markdown' } });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete (globalThis as typeof globalThis & { __ompChamberChangelogCache?: unknown }).__ompChamberChangelogCache;
  });

  test('reads the repository changelog and parses it', async () => {
    const notes = await fetchChangelogNotes();
    expect(urls[0]).toBe(CHANGELOG_URL);
    expect(notes[0]!.version).toBe('3.14.0');
  });

  test('a repeat read inside the TTL is served from the cache', async () => {
    await fetchChangelogNotes();
    await fetchChangelogNotes();
    expect(urls).toHaveLength(1);
  });

  test('force bypasses a warm cache', async () => {
    await fetchChangelogNotes();
    await fetchChangelogNotes(true);
    expect(urls).toHaveLength(2);
  });

  test('a failed read is an empty list, not a throw, and is not cached', async () => {
    status = 500;
    expect(await fetchChangelogNotes()).toEqual([]);
    expect(await fetchChangelogNotes()).toEqual([]);
    expect(urls).toHaveLength(2);
  });
});

describe('selectReleaseRange', () => {
  const releases = [note('3.14.0'), note('3.13.1'), note('3.13.0'), note('3.12.1'), note('3.12.0')];

  test('with no latest there is nothing to announce', () => {
    expect(selectReleaseRange([note('1.0.0')], '0.5.0', null)).toEqual([]);
  });

  test('keeps releases above the installed version and up to latest, newest first', () => {
    const range = selectReleaseRange(releases, '3.12.1', '3.14.0');
    expect(range.map((entry) => entry.version)).toEqual(['3.14.0', '3.13.1', '3.13.0']);
  });

  test('the installed version itself is excluded — the already-current decision', () => {
    expect(selectReleaseRange([note('3.14.0')], '3.14.0', '3.14.0')).toEqual([]);
  });

  test('ignores anything newer than the target release', () => {
    expect(selectReleaseRange([note('3.15.0'), ...releases], '3.12.1', '3.14.0').map((entry) => entry.version)).toEqual([
      '3.14.0',
      '3.13.1',
      '3.13.0',
    ]);
  });

  test('with no readable installed version the range is the latest release alone', () => {
    expect(selectReleaseRange(releases, null, '3.13.1').map((entry) => entry.version)).toEqual(['3.13.1']);
  });

  test('a pre-release version compares by its numeric core', () => {
    expect(selectReleaseRange([note('3.15.0-beta.1')], '3.14.0', '3.15.0').map((entry) => entry.version)).toEqual(['3.15.0-beta.1']);
  });

  test('a blank or non-numeric version is dropped', () => {
    expect(selectReleaseRange([note(''), note('nightly')], null, '3.14.0')).toEqual([]);
  });
});

describe('capReleaseNotes', () => {
  test('under both caps nothing is trimmed', () => {
    const notes = [note('2.0.0', 'x'.repeat(10)), note('1.9.0', 'y'.repeat(10))];
    expect(capReleaseNotes(notes)).toEqual({ versions: notes, truncated: false });
  });

  test('more than MAX_VERSIONS sections keeps the newest and reports truncation', () => {
    const notes = Array.from({ length: MAX_VERSIONS + 1 }, (_, i) => note(`1.0.${i}`));
    const { versions, truncated } = capReleaseNotes(notes);
    expect(versions).toHaveLength(MAX_VERSIONS);
    expect(versions[0]).toBe(notes[0]!);
    expect(truncated).toBe(true);
  });

  test('the byte budget drops the oldest sections', () => {
    const notes = [note('3.0.0', 'a'.repeat(60_000)), note('2.0.0', 'b'.repeat(60_000)), note('1.0.0', 'c'.repeat(60_000))];
    const { versions, truncated } = capReleaseNotes(notes);
    expect(versions.map((entry) => entry.version)).toEqual(['3.0.0', '2.0.0']);
    expect(truncated).toBe(true);
  });

  test('a single oversized section is still kept — the list is never emptied', () => {
    const { versions, truncated } = capReleaseNotes([note('1.0.0', 'z'.repeat(MAX_NOTES_BYTES + 1))]);
    expect(versions).toHaveLength(1);
    expect(truncated).toBe(false);
  });
});
