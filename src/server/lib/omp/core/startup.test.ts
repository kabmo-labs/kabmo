/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The startup gate and its banner.
 *
 * Split from `host-resolution.test.ts` when this suite pushed that file past
 * the 350-line ceiling: both are about what a process PRINTS about its omp
 * install, while the other file is about which host and binary it resolves.
 *
 * What is pinned is the difference between a message that names a prerequisite
 * and one that names the command satisfying it. The refusal is the only thing a
 * first-time user sees — it used to say "Install AI Oh-My-Pi and put `omp` on
 * your PATH", leaving the reader to find the package — so both install routes
 * and the `kabmo doctor` pointer are part of the contract, not decoration.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';

import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';
import { getAgentDir, getConfigRoot } from '@/server/lib/omp/core/paths';
import { ompStartupError, ompStartupLogLines } from '@/server/lib/omp/core/startup';

const tempDirs: string[] = [];
const realEnv = {
  KABMO_OMP_BIN: Bun.env.KABMO_OMP_BIN,
  MOCK: Bun.env.MOCK,
  PI_CODING_AGENT_DIR: Bun.env.PI_CODING_AGENT_DIR,
  PI_CONFIG_DIR: Bun.env.PI_CONFIG_DIR,
};

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(join(tmpdir(), `${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

/** A real file that exists on disk, for the binary override. */
function fakeBinary(): string {
  const file = join(tempDir('omp-bin'), 'omp');
  fs.writeFileSync(file, '#!/bin/sh\n');
  return file;
}

beforeAll(() => {
  invalidateOmpCliCache();
});

afterAll(() => {
  invalidateOmpCliCache();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(realEnv)) {
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
  }
});

describe('ompStartupError', () => {
  test('MOCK=true is exempt even when no binary resolves', () => {
    Bun.env.KABMO_OMP_BIN = join(tempDir('omp-mock'), 'omp');
    Bun.env.MOCK = 'true';
    invalidateOmpCliCache();
    expect(ompStartupError()).toBeNull();
  });

  test('a missing binary yields the actionable multi-line message', () => {
    Bun.env.KABMO_OMP_BIN = join(tempDir('omp-miss2'), 'omp');
    Bun.env.MOCK = 'false';
    invalidateOmpCliCache();
    const message = ompStartupError();
    expect(message).toContain('omp binary not found — Kabmo cannot start.');
    expect(message).toContain('KABMO_OMP_BIN=/path/to/omp');
    expect(message).toContain('MOCK=true');
  });

  test('the refusal carries both install commands and the doctor pointer', () => {
    Bun.env.KABMO_OMP_BIN = join(tempDir('omp-miss3'), 'omp');
    Bun.env.MOCK = 'false';
    invalidateOmpCliCache();
    const message = ompStartupError() ?? '';
    expect(message).toContain('bun install -g @oh-my-pi/pi-coding-agent');
    expect(message).toContain('curl -fsSL https://omp.sh/install | sh');
    expect(message).toContain('omp --version');
    expect(message).toContain('kabmo doctor');
    // Never a promise the product does not keep: the refusal states that Kabmo
    // does not install omp for the user.
    expect(message).toContain('never installs it for you');
  });

  test('a resolvable binary lets the app start', () => {
    Bun.env.KABMO_OMP_BIN = fakeBinary();
    Bun.env.MOCK = 'false';
    invalidateOmpCliCache();
    expect(ompStartupError()).toBeNull();
  });
});

describe('ompStartupLogLines', () => {
  test('names the executable actually spawned plus the config and agent dirs', () => {
    const bin = fakeBinary();
    const agentDir = tempDir('omp-agent');
    Bun.env.KABMO_OMP_BIN = bin;
    Bun.env.PI_CODING_AGENT_DIR = agentDir;
    Bun.env.PI_CONFIG_DIR = '.omp-alt';
    invalidateOmpCliCache();
    const lines = ompStartupLogLines();
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(`omp binary:     ${bin}`);
    expect(lines[1]).toBe(`omp config dir: ${join(homedir(), '.omp-alt')}`);
    expect(lines[2]).toBe(`omp agent dir:  ${agentDir}`);
  });

  test('the paths shown match the resolvers the running process uses', () => {
    delete Bun.env.PI_CONFIG_DIR;
    delete Bun.env.PI_CODING_AGENT_DIR;
    const lines = ompStartupLogLines();
    expect(lines[1]).toBe(`omp config dir: ${getConfigRoot()}`);
    expect(lines[2]).toBe(`omp agent dir:  ${getAgentDir()}`);
  });
});
