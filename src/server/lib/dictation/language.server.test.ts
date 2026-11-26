/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * omp's own `stt.language` reader.
 *
 * Pinned because the alternative is silent: the local Whisper pipeline treats a
 * MISSING language as English (measured — `languages.ts` carries the
 * transcripts), so "no value" and "English" are the same decode. Three
 * behaviours matter and none is obvious:
 *
 *  - the value comes from the live config, so a user's edit is what the next
 *    utterance uses (asserted through a stub `omp`, not a mirrored constant);
 *  - a value this build cannot use yields `undefined`, NOT a guess — the caller
 *    turns that into an explicit fallback, so the behaviour is stated once;
 *  - a write to the key drops the cache, so an edit applies at once instead of
 *    up to a minute later.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { executableStub } from '@/test-support/executable-stub';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { invalidateOmpCliCache } from '@kabmo-labs/kabmo-omp-cli';
import {
  invalidateDictationLanguage,
  onOmpConfigWritten,
  readOmpSttLanguage,
} from '@/server/lib/dictation/language.server';

/**
 * Answers `omp config get stt.language` from a file the test rewrites, so the
 * cached read is observable across calls. Never touches the real agent.
 *
 * The path comes from `FAKE_OMP_LANGUAGE_FILE`, NOT baked into the source: the
 * fixture binary is cached by a hash of its source, so a baked per-run
 * `mkdtempSync` path made every run compile a fresh ~90 MB binary and left the
 * old one in `$TMPDIR` forever (measured: +101 MB per `bun test` run). The
 * variable reaches the child because every spawn site passes an explicit `env`
 * built from `Bun.env` at spawn time (`childEnv()`), not the startup environ.
 */
const STUB_SOURCE = `const args = process.argv.slice(2);
const file = process.env.FAKE_OMP_LANGUAGE_FILE;
const value = (await Bun.file(file).text()).trim();
if (args[0] === 'config' && args[1] === 'get' && args[2] === 'stt.language') {
  process.stdout.write(JSON.stringify(value));
  process.exit(0);
}
process.stderr.write('Unknown setting: ' + (args[2] ?? '') + '\\n');
process.exit(1);
`;

const dirs: string[] = [];
let stubBin = '';
let langFile = '';
let realBin: string | undefined;
let realLangFile: string | undefined;
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
  stubBin = await executableStub(STUB_SOURCE, 'fake-omp-language');
  realBin = Bun.env.KABMO_OMP_BIN;
  realLangFile = Bun.env.FAKE_OMP_LANGUAGE_FILE;
  Bun.env.KABMO_OMP_BIN = stubBin;
  Bun.env.FAKE_OMP_LANGUAGE_FILE = langFile;
  // A sibling suite may have cached the real `omp` path for the process
  // lifetime; without this the stub is bypassed and the real agent is driven.
  invalidateOmpCliCache();
});

afterAll(() => {
  if (originalMock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = originalMock;
  if (realBin === undefined) delete Bun.env.KABMO_OMP_BIN;
  else Bun.env.KABMO_OMP_BIN = realBin;
  if (realLangFile === undefined) delete Bun.env.FAKE_OMP_LANGUAGE_FILE;
  else Bun.env.FAKE_OMP_LANGUAGE_FILE = realLangFile;
  invalidateOmpCliCache();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  Bun.env.MOCK = 'false';
  invalidateDictationLanguage();
});

describe('readOmpSttLanguage', () => {
  test('mock mode reports no stored language', async () => {
    Bun.env.MOCK = 'true';
    expect(await readOmpSttLanguage()).toBeUndefined();
  });

  test('reads the configured tag from omp config', async () => {
    setStubLanguage('id');
    expect(await readOmpSttLanguage()).toBe('id');
  });

  test('the value is cached until a write to stt.language drops it', async () => {
    setStubLanguage('id');
    expect(await readOmpSttLanguage()).toBe('id');
    // The config changed underneath; the cached value still answers...
    setStubLanguage('ja');
    expect(await readOmpSttLanguage()).toBe('id');
    // ...until the write seam fires, which is what makes an edit apply at once.
    onOmpConfigWritten('stt.language');
    expect(await readOmpSttLanguage()).toBe('ja');
  });

  test('a write to an unrelated key leaves the cached language alone', async () => {
    setStubLanguage('id');
    expect(await readOmpSttLanguage()).toBe('id');
    setStubLanguage('ja');
    onOmpConfigWritten('theme.dark');
    // The stale entry SURVIVES an unrelated write — the seam is keyed, not a
    // blanket flush, so a settings edit elsewhere does not re-spawn `omp`.
    expect(await readOmpSttLanguage()).toBe('id');
  });

  test('an unusable value is reported as absent, not forwarded', async () => {
    // The caller substitutes an explicit `en`; forwarding a junk tag would be
    // a language the recognizer cannot resolve.
    setStubLanguage('not a language tag!');
    expect(await readOmpSttLanguage()).toBeUndefined();
  });
});
