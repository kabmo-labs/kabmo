/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The stream-status rows: the model a run is served by, and the reads the
 * sidebar makes. The self-heal rules that decide when a row has been abandoned
 * live in `stream-heal.server.test.ts`, beside the module that owns them.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDir } from '@/test-support/remove-dir';

import {
  loadStreamStates,
  loadStreamStatuses,
  markStreamModel,
  markStreamStatus,
} from '@/shared/lib/omp/session/stream-state.server';

describe('run model on the stream row', () => {
  let root: string;
  let savedDbPath: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kabmo-ss-'));
    savedDbPath = Bun.env.KABMO_DB_PATH;
    // The writes resolve the database; point them at a temp tree so the real
    // `~/.kabmo` is never opened.
    Bun.env.KABMO_DB_PATH = join(root, 'db.sqlite');
    delete globalThis.__kabmoDb;
  });

  afterEach(() => {
    // CLOSE the handle before dropping the reference and deleting the tree. A
    // bare `delete globalThis.__kabmoDb` abandons the connection without
    // closing it, so the file stays locked; on Windows the delete then fails
    // with EBUSY and reports the PREVIOUS test as failed (measured on the first
    // Windows run: every case in this file).
    globalThis.__kabmoDb?.resolved?.raw.close();
    delete globalThis.__kabmoDb;
    if (savedDbPath === undefined) delete Bun.env.KABMO_DB_PATH;
    else Bun.env.KABMO_DB_PATH = savedDbPath;
    removeDir(root);
  });

  test('a dispatch write stores the pair, and a status-only re-mark keeps it', async () => {
    await markStreamStatus('s1', 'stream', { provider: 'anthropic', modelId: 'claude' });
    expect((await loadStreamStates()).s1).toEqual({
      status: 'stream',
      model: { provider: 'anthropic', modelId: 'claude' },
    });

    // agent_start / turn_start / message_start / the terminal badge all write
    // the status alone.
    await markStreamStatus('s1', 'finish');
    expect((await loadStreamStates()).s1).toEqual({
      status: 'finish',
      model: { provider: 'anthropic', modelId: 'claude' },
    });
  });

  test('a later run’s model replaces the previous one', async () => {
    await markStreamStatus('s1', 'stream', { provider: 'anthropic', modelId: 'claude' });
    await markStreamStatus('s1', 'stream', { provider: 'openai', modelId: 'gpt-5' });
    expect((await loadStreamStates()).s1?.model).toEqual({ provider: 'openai', modelId: 'gpt-5' });
  });

  test('a row written without a model reports none, and the status view is status-only', async () => {
    await markStreamStatus('s2', 'abort');
    expect((await loadStreamStates()).s2).toEqual({ status: 'abort' });
    expect(await loadStreamStatuses()).toEqual({ s2: 'abort' });
  });

  test('renames the model of a LIVE row, leaving its status and owner alone', async () => {
    // omp's payload-less `model_changed` — a fallback-chain retry swapped the
    // model mid-run, and the indicator must name what the answer came from.
    await markStreamStatus('s1', 'stream', { provider: 'anthropic', modelId: 'claude' });
    await markStreamModel('s1', { provider: 'openai', modelId: 'gpt-5' });
    expect((await loadStreamStates()).s1).toEqual({
      status: 'stream',
      model: { provider: 'openai', modelId: 'gpt-5' },
    });
  });

  test('never resurrects a row for a run that already ended', async () => {
    // A fallback landing on the run's LAST frame must not put the spinner back:
    // `markStreamStatus(..., 'stream', model)` would upsert one, which is why
    // the rename is a live-only UPDATE.
    await markStreamStatus('s2', 'finish', { provider: 'anthropic', modelId: 'claude' });
    await markStreamModel('s2', { provider: 'openai', modelId: 'gpt-5' });
    expect((await loadStreamStates()).s2).toEqual({
      status: 'finish',
      model: { provider: 'anthropic', modelId: 'claude' },
    });
  });

  test('does nothing for a session with no live row', async () => {
    await markStreamModel('s3', { provider: 'openai', modelId: 'gpt-5' });
    expect((await loadStreamStates()).s3).toBeUndefined();
  });
});
