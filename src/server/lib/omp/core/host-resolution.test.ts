/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where the chamber resolves its omp host from, and how it folds the state a
 * live child reports back. Each case pins a decision that fails silently:
 *
 *  - `resolveOmpBin` must not let a bad `OMPCHAMBER_OMP_BIN` fall through to a
 *    different omp on PATH, must re-probe when a cached hit disappears, and
 *    must not serve a cached MISS for the whole process lifetime (an install
 *    that lands while the server runs has to become visible).
 *  - `resolveProjectRoot` groups linked worktrees under the main repo; a
 *    non-git directory must resolve to itself, realpath-canonicalized.
 *  - `ompStartupError` is the one gate that keeps the server from booting
 *    without omp, with `MOCK=true` exempt by definition.
 *  - `buildWebState` reconciles the wrapper's running flags against the child's
 *    payload: dispatched-but-unstarted work and an unexpired continuation
 *    grace window keep a session "running" even when `isStreaming` is false.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';

import { invalidateOmpCliCache, resolveOmpBin } from '@/server/lib/omp/core/cli';
import { resolveProjectRoot } from '@/server/lib/omp/core/worktree';
import { ompStartupError, ompStartupLogLines } from '@/server/lib/omp/core/startup';
import { getAgentDir, getConfigRoot } from '@/server/lib/omp/core/paths';
import { buildWebState, type WebStateHost } from '@/server/lib/omp/rpc/web-state';
import type { RpcSessionState } from '@/server/lib/omp/rpc/constants';

const tempDirs: string[] = [];
const realEnv = {
  OMPCHAMBER_OMP_BIN: Bun.env.OMPCHAMBER_OMP_BIN,
  MOCK: Bun.env.MOCK,
  PI_CODING_AGENT_DIR: Bun.env.PI_CODING_AGENT_DIR,
  PI_CONFIG_DIR: Bun.env.PI_CONFIG_DIR,
};

function tempDir(prefix: string): string {
  // `os.tmpdir()`, not a `/tmp` fallback: there is no `/tmp` on Windows, and a
  // POSIX-literal root resolves against the current drive — the fixture then
  // never lands where the assertion looks for it.
  // `realpathSync` on the way out, not just at the assertion. On Windows
  // `os.tmpdir()` names the 8.3 SHORT form (`C:\Users\RUNNER~1\…`) while
  // `realpathSync` answers the long form (`C:\Users\runneradmin\…`), so a
  // fixture that compared the two spellings of one directory failed on the
  // spelling rather than on the resolution being tested.
  const dir = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), `${prefix}-`)));
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

describe('resolveOmpBin', () => {
  test('an OMPCHAMBER_OMP_BIN pointing at an existing file wins', () => {
    const bin = fakeBinary();
    Bun.env.OMPCHAMBER_OMP_BIN = bin;
    invalidateOmpCliCache();
    expect(resolveOmpBin()).toBe(bin);
  });

  test('a bad OMPCHAMBER_OMP_BIN yields null instead of falling through to PATH', () => {
    Bun.env.OMPCHAMBER_OMP_BIN = join(tempDir('omp-missing'), 'omp');
    invalidateOmpCliCache();
    expect(resolveOmpBin()).toBeNull();
  });

  test('a cached hit that has since been deleted is re-probed', () => {
    const bin = fakeBinary();
    Bun.env.OMPCHAMBER_OMP_BIN = bin;
    invalidateOmpCliCache();
    expect(resolveOmpBin()).toBe(bin);
    fs.rmSync(bin);
    // The override now points at a missing file, so the re-probe is a miss.
    expect(resolveOmpBin()).toBeNull();
  });

  test('a cached miss suppresses probing until the miss TTL elapses', () => {
    Bun.env.OMPCHAMBER_OMP_BIN = join(tempDir('omp-miss'), 'omp');
    invalidateOmpCliCache();
    expect(resolveOmpBin()).toBeNull();
    const bin = fakeBinary();
    Bun.env.OMPCHAMBER_OMP_BIN = bin;
    // Still inside MISS_TTL_MS: the install that just appeared is invisible.
    expect(resolveOmpBin()).toBeNull();
    // An explicit invalidation (after `omp update`) makes it visible at once.
    invalidateOmpCliCache();
    expect(resolveOmpBin()).toBe(bin);
  });
});

describe('resolveProjectRoot', () => {
  test('a directory that does not exist resolves to the path it was given', async () => {
    const missing = join(tempDir('omp-wt'), 'nope');
    expect(await resolveProjectRoot(missing)).toBe(missing);
  });

  test('a non-git directory resolves to its realpath', async () => {
    const dir = tempDir('omp-plain');
    expect(await resolveProjectRoot(dir)).toBe(fs.realpathSync(dir));
  });

  test('the result is cached per cwd, so a deleted directory still answers', async () => {
    const dir = tempDir('omp-cache');
    const first = await resolveProjectRoot(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(await resolveProjectRoot(dir)).toBe(first);
  });

  test('only a directory holding its own .git is treated as a repository', async () => {
    if (!Bun.which('git')) return;
    const root = tempDir('omp-repo');
    expect(Bun.spawnSync(['git', 'init', '-q', root]).exitCode).toBe(0);
    // The repository root itself resolves through git rev-parse.
    expect(await resolveProjectRoot(root)).toBe(fs.realpathSync(root));
    // A subdirectory has no .git of its own, so the check is per-directory
    // rather than an ancestor walk and the fallback returns the cwd itself.
    const nested = join(root, 'src', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    expect(await resolveProjectRoot(nested)).toBe(fs.realpathSync(nested));
  });

  test('a linked worktree resolves to the MAIN repository root', async () => {
    if (!Bun.which('git')) return;
    const root = tempDir('omp-main');
    expect(Bun.spawnSync(['git', 'init', '-q', root]).exitCode).toBe(0);
    const commit = Bun.spawnSync([
      'git',
      '-C',
      root,
      '-c',
      'user.email=t@example.com',
      '-c',
      'user.name=t',
      'commit',
      '--allow-empty',
      '-q',
      '-m',
      'init',
    ]);
    if (commit.exitCode !== 0) return;
    const worktree = join(tempDir('omp-wt-parent'), 'wt');
    const added = Bun.spawnSync(['git', '-C', root, 'worktree', 'add', '--detach', worktree]);
    if (added.exitCode !== 0) return;
    expect(await resolveProjectRoot(worktree)).toBe(fs.realpathSync(root));
  });
});

describe('ompStartupError', () => {
  test('MOCK=true is exempt even when no binary resolves', () => {
    Bun.env.OMPCHAMBER_OMP_BIN = join(tempDir('omp-mock'), 'omp');
    Bun.env.MOCK = 'true';
    invalidateOmpCliCache();
    expect(ompStartupError()).toBeNull();
  });

  test('a missing binary yields the actionable multi-line message', () => {
    Bun.env.OMPCHAMBER_OMP_BIN = join(tempDir('omp-miss2'), 'omp');
    Bun.env.MOCK = 'false';
    invalidateOmpCliCache();
    const message = ompStartupError();
    expect(message).toContain('omp binary not found — OMPChamber cannot start.');
    expect(message).toContain('OMPCHAMBER_OMP_BIN=/path/to/omp');
    expect(message).toContain('MOCK=true');
  });

  test('a resolvable binary lets the app start', () => {
    Bun.env.OMPCHAMBER_OMP_BIN = fakeBinary();
    Bun.env.MOCK = 'false';
    invalidateOmpCliCache();
    expect(ompStartupError()).toBeNull();
  });
});

describe('ompStartupLogLines', () => {
  test('names the executable actually spawned plus the config and agent dirs', () => {
    const bin = fakeBinary();
    const agentDir = tempDir('omp-agent');
    Bun.env.OMPCHAMBER_OMP_BIN = bin;
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

function webStateHost(overrides: Partial<WebStateHost> = {}): WebStateHost {
  return {
    streaming: false,
    compacting: false,
    promptRunning: false,
    promptDispatchPendingCount: 0,
    awaitingAgentStart: false,
    awaitingAgentStartDeadline: 0,
    continuationGraceUntil: 0,
    bashRunning: false,
    fastModeEnabled: false,
    isRunning: () => false,
    adoptSessionIdentity: () => {},
    ...overrides,
  };
}

function sessionState(overrides: Partial<RpcSessionState> = {}): RpcSessionState {
  return {
    sessionId: 's1',
    sessionFile: '/tmp/s1.jsonl',
    isStreaming: false,
    isCompacting: false,
    autoCompactionEnabled: true,
    interruptMode: 'immediate',
    steeringMode: 'all',
    followUpMode: 'one-at-a-time',
    messageCount: 3,
    queuedMessageCount: 0,
    ...overrides,
  };
}

describe('buildWebState', () => {
  test('mirrors the payload and adopts the identity omp reported', () => {
    let adopted: RpcSessionState | undefined;
    const host = webStateHost({ adoptSessionIdentity: (state) => (adopted = state) });
    const state = sessionState({ isStreaming: true, isCompacting: true });
    const web = buildWebState(host, state);
    expect(host.streaming).toBe(true);
    expect(host.compacting).toBe(true);
    expect(adopted).toBe(state);
    expect(web.sessionId).toBe('s1');
    expect(web.sessionFile).toBe('/tmp/s1.jsonl');
    expect(web.isStreaming).toBe(true);
  });

  test('fills the optional fields with their defaults', () => {
    const web = buildWebState(webStateHost(), sessionState({ sessionFile: undefined }));
    expect(web.sessionFile).toBe('');
    expect(web.systemPrompt).toBe('');
    expect(web.thinkingLevel).toBe('off');
    expect(web.contextUsage).toBeNull();
    expect(web.todoPhases).toEqual([]);
    expect(web.tokensPerSecond).toBeNull();
    expect(web.fastModeEnabled).toBe(false);
  });

  test('joins a multi-part system prompt with blank lines', () => {
    const web = buildWebState(webStateHost(), sessionState({ systemPrompt: ['a', 'b', 'c'] }));
    expect(web.systemPrompt).toBe('a\n\nb\n\nc');
  });

  test('maps the model payload including thinking efforts', () => {
    const web = buildWebState(
      webStateHost(),
      sessionState({ model: { id: 'm', provider: 'p', name: 'M', reasoning: true, thinking: { efforts: ['low'] } } }),
    );
    expect(web.model).toEqual({ id: 'm', provider: 'p', name: 'M', reasoning: true, thinking: { efforts: ['low'] } });
  });

  test('leaves the model undefined when the payload carries none', () => {
    expect(buildWebState(webStateHost(), sessionState()).model).toBeUndefined();
  });

  test('clears promptRunning once a settled turn is past its grace window', () => {
    const host = webStateHost({ promptRunning: true, continuationGraceUntil: Date.now() - 1 });
    const web = buildWebState(host, sessionState());
    expect(host.promptRunning).toBe(false);
    expect(web.isPromptRunning).toBe(false);
  });

  test('keeps promptRunning inside the continuation grace window', () => {
    const host = webStateHost({ promptRunning: true, continuationGraceUntil: Date.now() + 60_000 });
    const web = buildWebState(host, sessionState());
    expect(host.promptRunning).toBe(true);
    expect(web.isPromptRunning).toBe(true);
  });

  test('keeps promptRunning while a prompt dispatch is still pending', () => {
    const host = webStateHost({ promptRunning: true, promptDispatchPendingCount: 2 });
    expect(buildWebState(host, sessionState()).isPromptRunning).toBe(true);
  });

  test('keeps promptRunning while a dispatch awaits an unexpired agent start', () => {
    const host = webStateHost({
      promptRunning: true,
      awaitingAgentStart: true,
      awaitingAgentStartDeadline: Date.now() + 10_000,
    });
    const web = buildWebState(host, sessionState());
    expect(web.isPromptRunning).toBe(true);
    expect(host.awaitingAgentStart).toBe(true);
  });

  test('clears an expired agent-start deadline once nothing else is pending', () => {
    const host = webStateHost({
      promptRunning: true,
      awaitingAgentStart: true,
      awaitingAgentStartDeadline: Date.now() - 1,
    });
    const web = buildWebState(host, sessionState());
    expect(host.promptRunning).toBe(false);
    expect(host.awaitingAgentStart).toBe(false);
    expect(host.awaitingAgentStartDeadline).toBe(0);
    expect(web.isPromptRunning).toBe(false);
  });

  test('never clears the flags while the child still reports streaming', () => {
    const host = webStateHost({ promptRunning: true });
    const web = buildWebState(host, sessionState({ isStreaming: true }));
    expect(host.promptRunning).toBe(true);
    expect(web.isPromptRunning).toBe(true);
  });

  test('prefers the payload fast-mode flags over the host flag', () => {
    const host = webStateHost({ fastModeEnabled: false });
    expect(buildWebState(host, sessionState({ fastModeEnabled: true })).fastModeEnabled).toBe(true);
    expect(buildWebState(host, sessionState({ fastMode: true })).fastModeEnabled).toBe(true);
    expect(buildWebState(webStateHost({ fastModeEnabled: true }), sessionState()).fastModeEnabled).toBe(true);
  });
});
