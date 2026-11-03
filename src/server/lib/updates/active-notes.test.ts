/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "What's new" for the running version: the changelog section is chosen by the
 * version this machine reports, not by anything the caller says.
 *
 * Pinned here: the exact section wins over a newer one, `v` prefixes normalize,
 * a version the changelog does not name is reported rather than replaced by the
 * newest section, and an unreadable install is an error. The omp half uses the
 * same stub-binary shape as `omp.test.ts`, so no real binary or network is
 * needed; both changelog reads are stubbed per source URL.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { executableStub } from '@/test-support/executable-stub';
import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';
import { buildActiveReleaseNotes, selectActiveNote } from '@/server/lib/updates/active-notes';
import { readInstalledVersion } from '@/server/lib/updates/install';
import { ompReleaseTagUrl, releaseTagUrl } from '@/server/lib/updates/release-url';
import type { ReleaseNote } from '@/shared/types/updates';

/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const originalFetch = Bun.fetch;
const CACHE_SLOT = globalThis as { __kabmoChangelogCache?: unknown };

/** Same constant source as `omp.test.ts`: the compiled fixture is cached by source text. */
const OMP_STUB_SOURCE = `process.stdout.write(process.env.FAKE_OMP_VERSION_OUTPUT || '');`;

const note = (version: string): ReleaseNote => ({
  version,
  date: null,
  url: releaseTagUrl(version),
  body: `* notes for ${version}`,
});

/** A changelog naming each version, newest first as the real file is. */
function changelog(versions: string[]): string {
  return [
    '# Changelog',
    '',
    ...versions.flatMap((version) => [`## [${version}] — 2026-01-01`, '', note(version).body, '']),
  ].join('\n');
}

describe('selectActiveNote', () => {
  test('picks the section for the running version, not the newest one', () => {
    const notes = [note('2.0.0'), note('1.5.0'), note('1.0.0')];
    expect(selectActiveNote(notes, '1.5.0')?.version).toBe('1.5.0');
  });

  test('a heading `v` prefix and a bare binary version agree', () => {
    expect(selectActiveNote([{ ...note('1.2.3'), version: 'v1.2.3' }], '1.2.3')?.version).toBe('v1.2.3');
  });

  test('an unnamed version is null, never the newest section', () => {
    expect(selectActiveNote([note('2.0.0')], '1.0.0')).toBeNull();
  });

  test('no readable version is null', () => {
    expect(selectActiveNote([note('2.0.0')], null)).toBeNull();
  });
});

describe('buildActiveReleaseNotes', () => {
  const realOverride = Bun.env.KABMO_OMP_BIN;
  const realOutput = Bun.env.FAKE_OMP_VERSION_OUTPUT;

  /** Every changelog read answers the same page; the target decides the URL. */
  function stubChangelog(markdown: string, status = 200): void {
    globalThis.fetch = (async () =>
      new Response(markdown, { status, headers: { 'content-type': 'text/markdown' } })) as unknown as typeof fetch;
  }

  async function stubOmp(output: string): Promise<void> {
    Bun.env.FAKE_OMP_VERSION_OUTPUT = output;
    Bun.env.KABMO_OMP_BIN = await executableStub(OMP_STUB_SOURCE, 'fake-omp-version');
    invalidateOmpCliCache();
  }

  beforeEach(() => {
    delete CACHE_SLOT.__kabmoChangelogCache;
    Bun.env.KABMO_OMP_BIN = join(tmpdir(), 'kabmo-definitely-absent', 'omp');
    invalidateOmpCliCache();
  });

  afterEach(() => {
    if (realOverride === undefined) delete Bun.env.KABMO_OMP_BIN;
    else Bun.env.KABMO_OMP_BIN = realOverride;
    if (realOutput === undefined) delete Bun.env.FAKE_OMP_VERSION_OUTPUT;
    else Bun.env.FAKE_OMP_VERSION_OUTPUT = realOutput;
    globalThis.fetch = originalFetch;
    delete CACHE_SLOT.__kabmoChangelogCache;
    invalidateOmpCliCache();
  });

  test('kabmo: the section for the version on disk', async () => {
    const installed = await readInstalledVersion();
    expect(installed).not.toBeNull();
    stubChangelog(changelog(['999.0.0', installed!]));

    const result = await buildActiveReleaseNotes('kabmo');

    expect(result).toMatchObject({ target: 'kabmo', version: installed, error: null });
    expect(result.note?.body).toBe(`* notes for ${installed}`);
    expect(result.note?.url).toBe(releaseTagUrl(installed!));
    expect(result.changelogUrl).toBe('https://github.com/kabmo-labs/kabmo/blob/HEAD/CHANGELOG.md');
  });

  test('kabmo: a version the changelog never named is reported, not faked', async () => {
    stubChangelog(changelog(['999.0.0']));

    const result = await buildActiveReleaseNotes('kabmo');

    expect(result.note).toBeNull();
    expect(result.error).toBe(`No changelog section for v${await readInstalledVersion()}`);
  });

  test('kabmo: an unreachable changelog is an error field, not a throw', async () => {
    stubChangelog('', 500);

    const result = await buildActiveReleaseNotes('kabmo');

    expect(result.note).toBeNull();
    expect(result.error).toBe('Release notes could not be fetched');
  });

  test('omp: the section for the version the binary reports', async () => {
    await stubOmp('omp/18.3.0\n');
    stubChangelog(changelog(['18.4.0', '18.3.0']));

    const result = await buildActiveReleaseNotes('omp');

    expect(result).toMatchObject({ target: 'omp', version: '18.3.0', error: null });
    expect(result.note?.body).toBe('* notes for 18.3.0');
    expect(result.note?.url).toBe(ompReleaseTagUrl('18.3.0'));
  });

  test('omp: no binary is an error, not notes for some other version', async () => {
    const result = await buildActiveReleaseNotes('omp');

    expect(result).toMatchObject({ target: 'omp', version: null, note: null, error: 'omp binary not found' });
  });
});