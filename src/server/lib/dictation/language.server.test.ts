/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The dictation language resolver.
 *
 * Pinned because the alternative is silent: the route used to pass no language
 * at all, so every decode auto-detected while omp's OWN dictation reads
 * `stt.language` (default `"en"`) — the setting that decides whether a
 * non-English utterance transcribes correctly was unreachable from either
 * surface. Three behaviours matter and none is obvious:
 *
 *  - the value comes from the live config, so a user's edit is what the next
 *    utterance uses (asserted through a stub `omp`, not a mirrored constant);
 *  - a value omp cannot use yields `undefined` (auto-detect), NOT a guess — a
 *    read that fails must not pin every utterance to English;
 *  - a write to the key drops the cache, so an edit applies at once instead of
 *    up to a minute later.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { executableStub } from '@/test-support/executable-stub';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';
import {
  invalidateDictationLanguage,
  onOmpConfigWritten,
  resolveDictationLanguage,
} from '@/server/lib/dictation/language.server';

/**
 * Answers `omp config get stt.language` from a file the test rewrites, so the
 * cached read is observable across calls. Never touches the real agent.
 *
 * The path is BAKED into the stub rather than read from an environment
 * variable: `Bun.spawn` inherits the process's STARTUP environment, so a
 * `Bun.env.X = …` set by a test does not reach the child (verified on Bun
 * 1.4.2 — the child sees the variable only when `env:` is passed explicitly,
 * which the bridge does not do).
 */
function stubSource(langFile: string): string {
  return `const args = process.argv.slice(2);
const value = (await Bun.file(${JSON.stringify(langFile)}).text()).trim();
if (args[0] === 'config' && args[1] === 'get' && args[2] === 'stt.language') {
  process.stdout.write(JSON.stringify(value));
  process.exit(0);
}
process.stderr.write('Unknown setting: ' + (args[2] ?? '') + '\\n');
process.exit(1);
`;
}

const dirs: string[] = [];
let stubBin = '';
let langFile = '';
let realBin: string | undefined;
const originalMock = Bun.env.MOCK;

/** Point the stub at a language value (or an unreadable one for the failure case). */
function setStubLanguage(value: string): void {
  writeFileSync(langFile, value);
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omp-lang-'));
  dirs.push(dir);
  langFile = join(dir, 'language.txt');
  setStubLanguage('en');
  stubBin = await executableStub(stubSource(langFile), 'fake-omp-language');
  realBin = Bun.env.KABMO_OMP_BIN;
  Bun.env.KABMO_OMP_BIN = stubBin;
  // A sibling suite may have cached the real `omp` path for the process
  // lifetime; without this the stub is bypassed and the real agent is driven.
  invalidateOmpCliCache();
});

afterAll(() => {
  if (originalMock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = originalMock;
  if (realBin === undefined) delete Bun.env.KABMO_OMP_BIN;
  else Bun.env.KABMO_OMP_BIN = realBin;
  invalidateOmpCliCache();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  Bun.env.MOCK = 'false';
  invalidateDictationLanguage();
});

describe('resolveDictationLanguage', () => {
  test('mock mode reports no language, so the recognizer auto-detects', async () => {
    Bun.env.MOCK = 'true';
    expect(await resolveDictationLanguage()).toBeUndefined();
  });

  test('reads the configured tag from omp config', async () => {
    setStubLanguage('id');
    expect(await resolveDictationLanguage()).toBe('id');
  });

  test('the value is cached until a write to stt.language drops it', async () => {
    setStubLanguage('id');
    expect(await resolveDictationLanguage()).toBe('id');
    // The config changed underneath; the cached value still answers...
    setStubLanguage('ja');
    expect(await resolveDictationLanguage()).toBe('id');
    // ...until the write seam fires, which is what makes an edit apply at once.
    onOmpConfigWritten('stt.language');
    expect(await resolveDictationLanguage()).toBe('ja');
  });

  test('a write to an unrelated key leaves the cached language alone', async () => {
    setStubLanguage('id');
    expect(await resolveDictationLanguage()).toBe('id');
    setStubLanguage('ja');
    onOmpConfigWritten('theme.dark');
    // The stale entry SURVIVES an unrelated write — the seam is keyed, not a
    // blanket flush, so a settings edit elsewhere does not re-spawn `omp`.
    expect(await resolveDictationLanguage()).toBe('id');
  });

  test('an unusable value auto-detects instead of guessing', async () => {
    // A failed read must not pin every utterance to English, and must not be
    // cached as a miss for a full minute.
    setStubLanguage('not a language tag!');
    expect(await resolveDictationLanguage()).toBeUndefined();
  });
});
