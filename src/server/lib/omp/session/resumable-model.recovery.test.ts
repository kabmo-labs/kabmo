/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A session whose RECORDED model cannot be restored still starts.
 *
 * `omp --resume <file>` restores the model the session's last `model_change`
 * entry names, and it does NOT fall back when that model is gone: the child
 * exits(1) with `error: Could not restore model <provider>/<id>`, so every
 * command to that session fails with it — the `set_model` a model change
 * posts, the `get_state` warmup, and the `prompt` alike.
 *
 * Measured on omp 18.13.1 against a real session file: the user-visible shape
 * was "I changed the model, then sent a prompt to the previous session, and
 * the prompt never arrived". `--model <a model omp can resolve>` makes the
 * resume start (verified against the real binary), which is the lever the
 * recovery uses.
 *
 * This drives the REAL spawn path (`startRpcSession` → `RpcProcess` → the
 * scripted child), so the retry, the `--model` argument and the registration
 * bookkeeping are the shipped code — not a stub of it.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describePosix } from '@/test-support/platform';

import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';
import { stopDiscoveryRootsWatch } from '@/server/lib/omp/config/roots-watch.server';
import { getRpcSession, startRpcSession } from '@/server/lib/omp/rpc/session-registry';
import { invalidateResolvableModels } from '@/server/lib/omp/session/resumable-model.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

let root: string;
let agentDir: string;
let saved: Record<string, string | undefined>;

const ENV_KEYS = [
  'KABMO_OMP_BIN',
  'PI_CODING_AGENT_DIR',
  'KABMO_DB_PATH',
  'SYNC_WORKSPACE',
  'FAKE_OMP_RESTORE_FAILS',
  'FAKE_OMP_RESTORE_MODELS',
  'FAKE_OMP_RESTORE_LOG',
] as const;

/** The argv of every child the scripted omp started, in spawn order. */
function spawnedArgs(): string[][] {
  const path = Bun.env.FAKE_OMP_RESTORE_LOG;
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'omp-restore-test-'));
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, Bun.env[key]]));
  await isolateDb();
  agentDir = join(root, 'agent');
  Bun.env.KABMO_OMP_BIN = join(import.meta.dir, '../../../../test-support/fake-omp-restore.ts');
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
  Bun.env.SYNC_WORKSPACE = 'false';
  Bun.env.FAKE_OMP_RESTORE_FAILS = '1';
  Bun.env.FAKE_OMP_RESTORE_MODELS = 'kenari/deepseek-v4-flash,kenari/deepseek-v4-pro';
  Bun.env.FAKE_OMP_RESTORE_LOG = join(root, 'spawns.jsonl');
  invalidateOmpCliCache();
  invalidateResolvableModels();
  delete globalThis.__ompSessions;
  delete globalThis.__ompStartLocks;
  // The registry's fallback candidate: config.yml's `modelRoles.default`.
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, 'config.yml'),
    'modelRoles:\n  default: kenari/deepseek-v4-flash\n',
  );
});

afterEach(async () => {
  stopDiscoveryRootsWatch();
  delete globalThis.__ompSessions;
  delete globalThis.__ompStartLocks;
  invalidateOmpCliCache();
  invalidateResolvableModels();
  await releaseDb();
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

// The scripted omp is spawned from a `#!/usr/bin/env bun` file; Windows can
// start a real executable, not a shebang file, so `uv_spawn` answers EFTYPE.
describePosix('a session whose recorded model cannot be restored', () => {
  test('is respawned with a resolvable --model and comes up', async () => {
    const cwd = join(root, 'ws');
    const sessionsDir = join(root, 'agent', 'sessions', 'ws');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    const sessionFile = join(sessionsDir, 's.jsonl');
    writeFileSync(sessionFile, '');

    const { session } = await startRpcSession('restore-test-session', sessionFile, cwd);

    // The session is USABLE: the wrapper is alive and registered, which is what
    // the prompt path needs.
    expect(session.isAlive()).toBe(true);
    expect(getRpcSession('restore-test-session')).toBe(session);

    // Two spawns: the bare resume (which died with omp's own restore error),
    // then the recovered one carrying the model that resolves.
    const attempts = spawnedArgs();
    expect(attempts.length).toBe(2);
    expect(attempts[0]).not.toContain('--model');
    expect(attempts[1]).toContain('--model');
    expect(attempts[1][attempts[1].indexOf('--model') + 1]).toBe('kenari/deepseek-v4-flash');

    session.destroy();
  }, 30_000);

  test('the new child runs on the model it was resumed with', async () => {
    const cwd = join(root, 'ws');
    const sessionsDir = join(root, 'agent', 'sessions', 'ws');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    const sessionFile = join(sessionsDir, 's.jsonl');
    writeFileSync(sessionFile, '');

    const { session } = await startRpcSession('restore-test-model', sessionFile, cwd);
    const state = await session.send({ type: 'get_state' }) as { model?: { provider?: string; id?: string } };

    expect(state.model?.provider).toBe('kenari');
    expect(state.model?.id).toBe('deepseek-v4-flash');
    session.destroy();
  }, 30_000);

  test('the caller\'s own pick is the first recovery candidate', async () => {
    const cwd = join(root, 'ws');
    const sessionsDir = join(root, 'agent', 'sessions', 'ws');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    const sessionFile = join(sessionsDir, 's.jsonl');
    writeFileSync(sessionFile, '');

    // A `set_model` posts the operator's own pick, so the session resumes on
    // what they chose — but only through the recovery: the first attempt names
    // no model, because a stale pick must not make a healthy session
    // unopenable (omp answers `Model <x> not found` for one).
    const { session } = await startRpcSession(
      'restore-test-explicit',
      sessionFile,
      cwd,
      undefined,
      undefined,
      undefined,
      { provider: 'kenari', modelId: 'deepseek-v4-pro' },
    );

    const attempts = spawnedArgs();
    expect(attempts.length).toBe(2);
    expect(attempts[0]).not.toContain('--model');
    expect(attempts[1][attempts[1].indexOf('--model') + 1]).toBe('kenari/deepseek-v4-pro');
    session.destroy();
  }, 30_000);

  test('an unrecoverable resume still reports the failure', async () => {
    // No model omp can resolve: the catalog is empty and no default is set.
    Bun.env.FAKE_OMP_RESTORE_MODELS = '';
    writeFileSync(join(agentDir, 'config.yml'), '{}\n');
    invalidateResolvableModels();

    const cwd = join(root, 'ws');
    const sessionsDir = join(root, 'agent', 'sessions', 'ws');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    const sessionFile = join(sessionsDir, 's.jsonl');
    writeFileSync(sessionFile, '');

    // The failure is NOT swallowed: the caller sees omp's own sentence, which
    // names the model that could not be restored.
    const failure = await startRpcSession('restore-test-honest', sessionFile, cwd).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('Could not restore model');
  }, 30_000);
});