/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `omp config` CLI bridge's failure surfacing.
 *
 * Pinned because a dropped stderr is silent and mislabels every refusal: the
 * bridge used to read stdout alone and throw `omp config failed: exited with
 * code 1`, so a key omp no longer has (measured at 18.11.0:
 * `providers.openai-codex.codeMode`, removed upstream in 18.10.4) was
 * indistinguishable from a bad value, a permission failure or a timeout — and
 * the panel rendered all of them as a bare `save failed`.
 *
 * The stub binary reproduces omp's own shapes, captured verbatim from
 * `omp 18.11.0`:
 *
 *   $ omp config set providers.openai-codex.codeMode off
 *   Unknown setting: providers.openai-codex.codeMode
 *
 *   Run 'omp config list' to see available keys
 *
 *   $ omp config set stt.enabled notabool
 *   Error: Invalid boolean value: notabool. Use true/false, yes/no, on/off, or 1/0
 *
 * The reason is the FIRST line and the hint comes last, which is why the
 * reader takes the first non-empty line — the opposite of `pluginCliError`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { executableStub } from '@/test-support/executable-stub';

import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';
import {
  configFailureLine,
  getOmpConfigValue,
  listOmpConfig,
  resetOmpConfigKey,
  setOmpConfigValue,
} from '@/server/lib/omp/config/config-cli';

/**
 * Answers `omp config …` from the invocation itself, so each test states the
 * shape it is exercising. Never touches the real agent.
 */
const STUB_SOURCE = `const args = process.argv.slice(2);
const [, action, key] = args;
const fail = (message) => {
  process.stderr.write(message + '\\n');
  process.exit(1);
};
switch (action) {
  case 'list':
    process.stdout.write(JSON.stringify({ 'stt.enabled': { value: false, type: 'boolean', description: 'Speech-to-text' } }));
    break;
  case 'get':
    if (key === 'stt.enabled') process.stdout.write('false');
    else fail("Unknown setting: " + key + "\\n\\nRun 'omp config list' to see available keys");
    break;
  case 'set':
    // A value the schema refuses reports on stderr and exits 1 (measured).
    if (process.argv[5] === 'notabool') fail('Error: Invalid boolean value: notabool. Use true/false, yes/no, on/off, or 1/0');
    if (key !== 'stt.enabled') fail("Unknown setting: " + key + "\\n\\nRun 'omp config list' to see available keys");
    break;
  case 'reset':
    if (key !== 'stt.enabled') fail("Unknown setting: " + key + "\\n\\nRun 'omp config list' to see available keys");
    break;
  default:
    fail('Unknown command: ' + action);
}
`;

let stubBin = '';
let realBin: string | undefined;
const originalMock = Bun.env.MOCK;

beforeAll(async () => {
  stubBin = await executableStub(STUB_SOURCE, 'fake-omp-config');
  realBin = Bun.env.OMPCHAMBER_OMP_BIN;
  Bun.env.OMPCHAMBER_OMP_BIN = stubBin;
  // A sibling suite may have cached the real `omp` path for the process
  // lifetime; without this the stub is bypassed and the real agent is driven.
  invalidateOmpCliCache();
});

afterAll(() => {
  if (originalMock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = originalMock;
  if (realBin === undefined) delete Bun.env.OMPCHAMBER_OMP_BIN;
  else Bun.env.OMPCHAMBER_OMP_BIN = realBin;
  invalidateOmpCliCache();
});

describe('configFailureLine', () => {
  test("takes omp's reason, not the trailing hint", () => {
    expect(configFailureLine({
      ok: false,
      stdout: '',
      stderr: "Unknown setting: providers.openai-codex.codeMode\n\nRun 'omp config list' to see available keys\n",
    })).toBe('Unknown setting: providers.openai-codex.codeMode');
  });

  test('strips the status glyph omp keeps on a non-TTY stream', () => {
    expect(configFailureLine({ ok: false, stdout: '', stderr: '✖ Error: Invalid value: nonsense\n' }))
      .toBe('Error: Invalid value: nonsense');
  });

  test('falls back to stdout, then to null when both streams are empty', () => {
    expect(configFailureLine({ ok: false, stdout: 'only stdout\n', stderr: '' })).toBe('only stdout');
    expect(configFailureLine({ ok: false, stdout: '', stderr: '   \n\n' })).toBeNull();
  });
});

describe('a rejected key reports omp’s own sentence', () => {
  test('set on an unknown key carries "Unknown setting" and the key', async () => {
    Bun.env.MOCK = 'false';
    await expect(setOmpConfigValue('providers.openai-codex.codeMode', 'off'))
      .rejects.toThrow('Unknown setting: providers.openai-codex.codeMode');
  });

  test('get on an unknown key carries the same sentence', async () => {
    Bun.env.MOCK = 'false';
    await expect(getOmpConfigValue('nope.nope')).rejects.toThrow('Unknown setting: nope.nope');
  });

  test('reset on an unknown key carries the same sentence', async () => {
    Bun.env.MOCK = 'false';
    await expect(resetOmpConfigKey('nope.nope')).rejects.toThrow('Unknown setting: nope.nope');
  });

  test('a rejected VALUE keeps the value error rather than a generic exit code', async () => {
    Bun.env.MOCK = 'false';
    await expect(setOmpConfigValue('stt.enabled', 'notabool'))
      .rejects.toThrow('Invalid boolean value: notabool');
  });
});

describe('an accepted call is unchanged', () => {
  test('list parses the snapshot and get reads a known key', async () => {
    Bun.env.MOCK = 'false';
    expect(await listOmpConfig()).toEqual({
      'stt.enabled': { value: false, type: 'boolean', description: 'Speech-to-text' },
    });
    expect(await getOmpConfigValue('stt.enabled')).toBe(false);
  });

  test('set and reset on a known key succeed', async () => {
    Bun.env.MOCK = 'false';
    expect(await setOmpConfigValue('stt.enabled', true)).toBe(false);
    expect(await resetOmpConfigKey('stt.enabled')).toBe(false);
  });
});
