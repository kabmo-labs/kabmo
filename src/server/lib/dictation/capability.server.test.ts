/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The local-engine capability probe.
 *
 * The probe is the only thing standing between a user and a bare
 * `STT worker exited.`: omp changed the worker's transport between 18.11 and
 * 19.1, so "is it installed" is not the question — "did it answer a ping" is.
 * The three behaviours pinned here are the ones a refactor would silently lose:
 * mock mode never spawns, a worker that dies is reported with a sentence that
 * names the setting, and the answer is cached so a re-rendering page does not
 * spawn a child per render.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { executableStub } from '@/test-support/executable-stub';
import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';
import { removeDir } from '@/test-support/remove-dir';
import { recycleSttWorker } from '@/server/lib/dictation/omp-stt-worker';
import {
  invalidateLocalDictationCapability,
  localDictationCapability,
} from '@/server/lib/dictation/capability.server';

/**
 * A worker that exits before answering anything — the 19.1.1 failure mode with
 * the 18.x transport. Constant source (the fixture cache is keyed by it); the
 * run counter arrives through the environment.
 */
const STUB_SOURCE = `const counter = process.env.FAKE_STT_SPAWN_FILE;
if (counter) {
  const previous = await Bun.file(counter).text().catch(() => '0');
  await Bun.write(counter, String(Number(previous || '0') + 1));
}
process.exit(0);
`;

const originalBin = Bun.env.KABMO_OMP_BIN;
const originalCounter = Bun.env.FAKE_STT_SPAWN_FILE;
let dir = '';
let counter = '';

function spawns(): number {
  try {
    return Number(fs.readFileSync(counter, 'utf8').trim()) || 0;
  } catch {
    return 0;
  }
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-stt-capability-'));
  counter = path.join(dir, 'spawns.txt');
  Bun.env.FAKE_STT_SPAWN_FILE = counter;
  delete Bun.env.MOCK;
  recycleSttWorker();
  invalidateLocalDictationCapability();
});

afterEach(() => {
  recycleSttWorker();
  invalidateLocalDictationCapability();
  if (originalBin === undefined) delete Bun.env.KABMO_OMP_BIN;
  else Bun.env.KABMO_OMP_BIN = originalBin;
  if (originalCounter === undefined) delete Bun.env.FAKE_STT_SPAWN_FILE;
  else Bun.env.FAKE_STT_SPAWN_FILE = originalCounter;
  invalidateOmpCliCache();
  delete Bun.env.MOCK;
  removeDir(dir);
});

describe('localDictationCapability', () => {
  test('mock mode reports unavailable without spawning anything', async () => {
    Bun.env.MOCK = 'true';
    const capability = await localDictationCapability(true);
    expect(capability.available).toBe(false);
    expect(capability.reason).toContain('Mock mode');
    expect(spawns()).toBe(0);
  });

  test('a worker that dies is reported with a sentence naming the setting', async () => {
    Bun.env.KABMO_OMP_BIN = await executableStub(STUB_SOURCE, 'fake-omp-stt-dead');
    invalidateOmpCliCache();

    const capability = await localDictationCapability(true);

    expect(capability.available).toBe(false);
    expect(capability.reason).toContain('Settings → Dictation');
    // The refusal is the probe's, not a bare process-exit string: a worker that
    // never answered is the version-mismatch shape, and the reader is told so.
    expect(capability.reason).toContain('exited before answering');
    expect(capability.reason).not.toContain('STT worker exited.');
  });

  test('the answer is cached, and `force` re-probes', async () => {
    Bun.env.KABMO_OMP_BIN = await executableStub(STUB_SOURCE, 'fake-omp-stt-dead');
    invalidateOmpCliCache();

    await localDictationCapability();
    await localDictationCapability();
    expect(spawns()).toBe(1);

    await localDictationCapability(true);
    expect(spawns()).toBe(2);
  });
});
