/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The oh-my-pi (`omp`) update check: the version the binary reports, compared
 * against the version npm serves. Both halves are decidable without a network or
 * a real omp install — a stub binary answers `omp --version`, and the registry
 * read is an injected `fetch` — so the two failure modes that matter are pinned:
 * an unreadable npm answer must not claim an update, and a binary that prints no
 * version must not either.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { executableStub } from '@/test-support/executable-stub';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyOmpUpdate, checkOmpUpdate } from '@/server/lib/updates/omp';
import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';

/** Prints `omp --version` from the environment, so the source is constant and the
 * compiled fixture is reused across runs and across answers. */
const STUB_SOURCE = `process.stdout.write(process.env.FAKE_OMP_VERSION_OUTPUT || '');`;

/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const originalFetch = Bun.fetch;

describe('omp update check', () => {
  const realOverride = Bun.env.KABMO_OMP_BIN;
  const realOutput = Bun.env.FAKE_OMP_VERSION_OUTPUT;

  /**
   * A stand-in binary: the check only reads `omp --version` from it.
   *
   * The answer comes from `FAKE_OMP_VERSION_OUTPUT`, NOT baked into the source:
   * the fixture binary is cached by a hash of its source, so a baked per-case
   * answer compiled a fresh ~90 MB binary for every distinct output and left the
   * old ones in `$TMPDIR` forever. The variable reaches the child because the
   * spawn site passes `env` built from `Bun.env` at spawn time.
   */
  function stubOmp(output: string): Promise<string> {
    Bun.env.FAKE_OMP_VERSION_OUTPUT = output;
    return executableStub(STUB_SOURCE, 'fake-omp-version');
  }

  /** The registry answering one fixed version. */
  function stubRegistry(version: string): void {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ version }), { status: 200 })) as unknown as typeof fetch;
  }

  beforeEach(() => {
    // A path that cannot exist: probeOmpBin returns null from the override
    // without ever touching PATH, so the guard is deterministic on any machine.
    Bun.env.KABMO_OMP_BIN = join(tmpdir(), 'kabmo-definitely-absent', 'omp');
    invalidateOmpCliCache();
  });

  afterEach(() => {
    if (realOverride === undefined) delete Bun.env.KABMO_OMP_BIN;
    else Bun.env.KABMO_OMP_BIN = realOverride;
    if (realOutput === undefined) delete Bun.env.FAKE_OMP_VERSION_OUTPUT;
    else Bun.env.FAKE_OMP_VERSION_OUTPUT = realOutput;
    globalThis.fetch = originalFetch;
    invalidateOmpCliCache();
  });

  test('reports omp as not installed without spawning it', async () => {
    expect(await checkOmpUpdate()).toEqual({
      current: null,
      latest: null,
      updateAvailable: false,
      installed: false,
      error: 'omp binary not found',
    });
  });

  test('applyOmpUpdate refuses to run without a binary', async () => {
    await expect(applyOmpUpdate()).rejects.toThrow('omp binary not found');
  });

  test('compares the binary’s own version against the npm latest', async () => {
    Bun.env.KABMO_OMP_BIN = await stubOmp('omp/18.6.0\n');
    invalidateOmpCliCache();
    stubRegistry('18.7.0');

    expect(await checkOmpUpdate()).toEqual({
      current: '18.6.0',
      latest: '18.7.0',
      updateAvailable: true,
      installed: true,
      error: null,
    });
  });

  test('the installed version being the newest is not an update', async () => {
    Bun.env.KABMO_OMP_BIN = await stubOmp('omp/18.6.0\n');
    invalidateOmpCliCache();
    stubRegistry('18.6.0');

    expect(await checkOmpUpdate()).toEqual({
      current: '18.6.0',
      latest: '18.6.0',
      updateAvailable: false,
      installed: true,
      error: null,
    });
  });

  test('an npm read that fails is reported, and no update is claimed', async () => {
    Bun.env.KABMO_OMP_BIN = await stubOmp('omp/18.6.0\n');
    invalidateOmpCliCache();
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;

    const info = await checkOmpUpdate();
    expect(info).toMatchObject({ current: '18.6.0', latest: null, updateAvailable: false, installed: true });
    expect(info.error).toBe('Could not read the latest oh-my-pi version from npm');
  });

  test('a binary that prints no version is an error, not an available update', async () => {
    Bun.env.KABMO_OMP_BIN = await stubOmp('');
    invalidateOmpCliCache();
    stubRegistry('18.7.0');

    const info = await checkOmpUpdate();
    expect(info).toMatchObject({ current: null, updateAvailable: false, installed: true });
    expect(info.error).toBe('Could not determine the installed omp version');
  });
});
