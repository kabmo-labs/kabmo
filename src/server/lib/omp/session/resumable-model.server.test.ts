/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The recovery for a session whose RECORDED model no longer exists.
 *
 * `omp --resume <file>` restores the model the session's last `model_change`
 * entry names, and it does NOT fall back when that model is gone: the child
 * exits(1) with "Could not restore model <provider>/<id>", and EVERY command
 * to that session fails with it — the `set_model` a model change posts, the
 * `get_state` warmup, and the `prompt` alike.
 *
 * Measured on omp 18.13.1: a session whose last `model_change` named a
 * provider that is not in the registry (`deepseek/deepseek-flash`) could not
 * receive a prompt at all, and the user-visible shape was "I changed the
 * model, then sent a prompt to the previous session, and the prompt never
 * arrived".
 *
 * These cases pin the two halves of the recovery:
 *   - the FAILURE is recognised from omp's own message, and nothing else is;
 *   - the RESPAWN carries `--model <a model omp can resolve>`, which is what
 *     makes the resume succeed (verified against the real omp binary).
 */

import { describe, expect, test } from 'bun:test';

import { isUnrestorableModelFailure } from '@/server/lib/omp/session/resumable-model.server';
import { buildSessionSpawnArgs } from '@/server/lib/omp/rpc/constants';

describe('the unrestorable-model failure', () => {
  // omp's own wording, as it appears in the child's stderr tail.
  const restoreFailure = 'omp exited (code 1, signal none): error: Could not restore model deepseek/deepseek-flash\n';

  test('is recognised from omp\'s own sentence', () => {
    expect(isUnrestorableModelFailure(new Error(restoreFailure))).toBe(true);
  });

  test('is recognised from a bare message too', () => {
    expect(isUnrestorableModelFailure(new Error('Could not restore model kenari/gone'))).toBe(true);
  });

  test('another spawn failure is NOT this one', () => {
    // A wrong cwd, a missing binary, a crash: each needs its own report, and
    // respawning with a different model would hide the real cause.
    expect(isUnrestorableModelFailure(new Error('omp exited (code 1): spawn ENOENT'))).toBe(false);
    expect(isUnrestorableModelFailure(new Error('omp binary not found'))).toBe(false);
    expect(isUnrestorableModelFailure(new Error('omp exited (code 137, signal SIGKILL)'))).toBe(false);
  });

  test('a non-Error throw is judged by its text', () => {
    expect(isUnrestorableModelFailure('Could not restore model a/b')).toBe(true);
    expect(isUnrestorableModelFailure(undefined)).toBe(false);
  });
});

describe('the resume model on the spawn', () => {
  test('is named so omp restores a model that resolves', () => {
    const args = buildSessionSpawnArgs('/tmp/session.jsonl', 'always-ask', {
      provider: 'kenari',
      modelId: 'deepseek-v4-flash',
    });
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('kenari/deepseek-v4-flash');
  });

  test('is omitted when there is no replacement', () => {
    // A healthy session is spawned exactly as before: omp restores the
    // transcript's own model, and no catalog is read for it.
    expect(buildSessionSpawnArgs('/tmp/session.jsonl', 'always-ask')).not.toContain('--model');
  });

  test('a half-specified model is not passed on', () => {
    const args = buildSessionSpawnArgs('/tmp/session.jsonl', 'always-ask', {
      provider: 'kenari',
      modelId: '',
    });
    expect(args).not.toContain('--model');
  });

  test('the resume file and the approval mode are untouched', () => {
    const args = buildSessionSpawnArgs('/tmp/session.jsonl', 'yolo', {
      provider: 'kenari',
      modelId: 'deepseek-v4-flash',
    });
    expect(args[args.indexOf('--resume') + 1]).toBe('/tmp/session.jsonl');
    expect(args[args.indexOf('--approval-mode') + 1]).toBe('yolo');
  });
});
