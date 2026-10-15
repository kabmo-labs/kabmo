/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Saved rate-limit resets: the parse, the list, and the spend.
 *
 * Pinned because both halves are easy to get silently wrong:
 *
 *  - a row without a `credentialId` cannot be spent (the target grammar is
 *    `<provider>/<credential id>`), so rendering it would draw a dead button;
 *  - omp exits 1 for "no accounts" AND for a real failure, so an empty list and
 *    a failed read look identical on screen — the list path must REPORT the
 *    failure rather than answer an empty list;
 *  - a spend refusal (`already_redeemed`, `nothing_to_reset`) is a normal
 *    outcome, so its sentence must survive rather than collapsing to `ok:false`.
 *
 * Shapes captured from `omp usage reset --json` on 18.11.0.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';
import { listUsageResets, parseUsageResetList, spendUsageReset } from '@/server/lib/usage/reset.server';

/** Answers `omp usage reset …` from a file the test rewrites. */
function stubSource(responseFile: string): string {
  return `#!/usr/bin/env bun
const raw = (await Bun.file(${JSON.stringify(responseFile)}).text()).trim();
const { stdout = '', stderr = '', exit = 0 } = raw ? JSON.parse(raw) : {};
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
process.exit(exit);
`;
}

const dirs: string[] = [];
let stubBin = '';
let responseFile = '';
let realBin: string | undefined;
const originalMock = Bun.env.MOCK;

/** Point the stub at an outcome. */
function stubResult(result: { stdout?: string; stderr?: string; exit?: number }): void {
  writeFileSync(responseFile, JSON.stringify(result));
}

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'omp-usage-reset-'));
  dirs.push(dir);
  stubBin = join(dir, 'fake-omp');
  responseFile = join(dir, 'response.json');
  stubResult({ stdout: '{"generatedAt":1,"accounts":[]}' });
  writeFileSync(stubBin, stubSource(responseFile));
  chmodSync(stubBin, 0o755);
  realBin = Bun.env.OMPCHAMBER_OMP_BIN;
  Bun.env.OMPCHAMBER_OMP_BIN = stubBin;
  invalidateOmpCliCache();
});

afterAll(() => {
  if (originalMock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = originalMock;
  if (realBin === undefined) delete Bun.env.OMPCHAMBER_OMP_BIN;
  else Bun.env.OMPCHAMBER_OMP_BIN = realBin;
  invalidateOmpCliCache();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  Bun.env.MOCK = 'false';
});

describe('parseUsageResetList', () => {
  test('keeps a spendable account and its credits', () => {
    const list = parseUsageResetList({
      generatedAt: 1792031781355,
      accounts: [{
        provider: 'openai-codex',
        credentialId: 'cred-1',
        email: 'a@b.c',
        availableCount: 2,
        redeemableCount: 1,
        nextCreditId: 'c1',
        credits: [{ id: 'c1', title: 'Rate-limit reset', usable: true, clears: ['openai-codex:5h'] }],
      }],
    });
    expect(list.accounts).toHaveLength(1);
    expect(list.accounts[0].credentialId).toBe('cred-1');
    expect(list.accounts[0].redeemableCount).toBe(1);
    expect(list.accounts[0].credits[0].clears).toEqual(['openai-codex:5h']);
  });

  test('drops an account with no credential id — its button could never work', () => {
    const list = parseUsageResetList({
      accounts: [
        { provider: 'anthropic', credits: [] },
        { provider: 'anthropic', credentialId: 'ok', credits: [] },
      ],
    });
    expect(list.accounts.map((account) => account.credentialId)).toEqual(['ok']);
  });

  test('an unknown payload is an empty list, not a throw', () => {
    expect(parseUsageResetList(null).accounts).toEqual([]);
    expect(parseUsageResetList({ accounts: 'nope' }).accounts).toEqual([]);
  });

  test('a credit with no id is dropped rather than rendered', () => {
    const list = parseUsageResetList({
      accounts: [{ provider: 'anthropic', credentialId: 'c', credits: [{ title: 'x' }, { id: 'keep' }] }],
    });
    expect(list.accounts[0].credits.map((credit) => credit.id)).toEqual(['keep']);
  });
});

describe('listUsageResets', () => {
  test('parses a successful read', async () => {
    stubResult({
      stdout: JSON.stringify({
        generatedAt: 5,
        accounts: [{ provider: 'anthropic', credentialId: 'a1', availableCount: 1, credits: [] }],
      }),
    });
    const list = await listUsageResets();
    expect(list.generatedAt).toBe(5);
    expect(list.accounts[0].provider).toBe('anthropic');
  });

  test('a failed read REPORTS omp’s sentence instead of answering an empty list', async () => {
    stubResult({ stderr: 'No Codex or Claude accounts found. Run `omp` and use /login to add one.\n', exit: 1 });
    await expect(listUsageResets()).rejects.toThrow('No Codex or Claude accounts found');
  });

  test('malformed JSON is reported, not silently empty', async () => {
    stubResult({ stdout: 'not json' });
    await expect(listUsageResets()).rejects.toThrow('unexpected JSON');
  });
});

describe('spendUsageReset', () => {
  test('a success keeps omp’s own sentence', async () => {
    stubResult({ stdout: "Reset applied for a@b.c (Codex) — Claude's 5h session limit has been refreshed; weekly limits are unchanged.\n" });
    const result = await spendUsageReset('openai-codex/cred-1');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Reset applied for a@b.c');
  });

  test('a refusal is an outcome with its reason, not a bare failure', async () => {
    stubResult({ stderr: 'a@b.c (Codex): that reset was already redeemed.\n', exit: 1 });
    const result = await spendUsageReset('openai-codex/cred-1');
    expect(result.ok).toBe(false);
    expect(result.message).toBe('a@b.c (Codex): that reset was already redeemed.');
  });

  test('an unknown target reports the same way', async () => {
    stubResult({ stderr: 'No stored account matches "openai-codex/foo". List choices with `omp usage reset`.\n', exit: 1 });
    const result = await spendUsageReset('openai-codex/foo');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('No stored account matches');
  });
});

describe('mock mode', () => {
  test('lists a deterministic demo and refuses a spend', async () => {
    Bun.env.MOCK = 'true';
    const list = await listUsageResets();
    expect(list.accounts.length).toBeGreaterThan(0);
    const result = await spendUsageReset('openai-codex/demo-codex-1');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('demo mode');
  });
});
