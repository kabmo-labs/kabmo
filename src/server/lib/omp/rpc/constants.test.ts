/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The RPC command/constant contract shared with the omp CLI and with the
 * session dispatcher.
 *
 * These tests exist because every value here is load-bearing in a way that is
 * invisible at the call site: the timeout windows decide whether a wedged child
 * is reclaimed or a live turn is destroyed, the command sets decide whether a
 * command is forwarded verbatim or refused, the image limits are the only
 * server-side bound on what a client may POST, and the argv builders are the
 * literal contract with the omp binary (`--resume`, `--approval-mode`, `-e`).
 * A silent change to any of them is a behavior change, so the exact values and
 * the argument ORDER are pinned.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { titleModelOverlayPath } from '@/server/lib/omp/session/title-model-overlay.server';

import {
  AWAITING_AGENT_START_TIMEOUT_MS,
  ANSWERABLE_UI_METHODS,
  CONVERSATION_MOVING_COMMANDS,
  GET_STATE_TIMEOUT_MS,
  IDLE_REAP_MS,
  IMAGE_BEARING_COMMANDS,
  MAX_AGGREGATE_IMAGE_BYTES,
  MAX_ATTACHED_IMAGE_BYTES,
  MAX_ATTACHED_IMAGES,
  NON_TERMINAL_CONTINUATION_GRACE_MS,
  OBSERVER_ONLY_COMMANDS,
  PASSTHROUGH_COMMANDS,
  PROMPT_ACK_TIMEOUT_MS,
  READY_TIMEOUT_MS,
  RELOAD_PLUGINS_TIMEOUT_MS,
  RESTARTING_MESSAGE,
  SESSION_BUSY_MESSAGE,
  SUBAGENT_STALE_MS,
  buildSessionSpawnArgs,
  resolveSpawnCwd,
  toImageContents,
  validateAgentImages,
} from '@/server/lib/omp/rpc/constants';
import { chamberExtensionArgs } from '@/server/lib/omp/extensions/locator';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ompchamber-test-'));
  tempDirs.push(dir);
  return dir;
}

describe('timeout windows and messages', () => {
  test('reclaim windows keep their measured values', () => {
    expect(IDLE_REAP_MS).toBe(600_000);
    expect(SUBAGENT_STALE_MS).toBe(1_800_000);
  });

  test('command timeouts keep their values', () => {
    expect(READY_TIMEOUT_MS).toBe(120_000);
    expect(GET_STATE_TIMEOUT_MS).toBe(5_000);
    expect(PROMPT_ACK_TIMEOUT_MS).toBe(30_000);
    expect(RELOAD_PLUGINS_TIMEOUT_MS).toBe(10_000);
    expect(NON_TERMINAL_CONTINUATION_GRACE_MS).toBe(2_000);
    expect(AWAITING_AGENT_START_TIMEOUT_MS).toBe(10_000);
  });

  test('user-facing messages are verbatim', () => {
    expect(RESTARTING_MESSAGE).toBe('This session is restarting — retry in a moment.');
    expect(SESSION_BUSY_MESSAGE).toBe('The OMP session is busy with the running turn; retry once it settles.');
  });
});

describe('command classification sets', () => {
  test('passthrough commands are the exact verbatim-forward set', () => {
    expect(PASSTHROUGH_COMMANDS.size).toBe(25);
    for (const command of ['abort', 'steer', 'follow_up', 'set_thinking_level', 'set_todos', 'get_login_providers', 'login', 'cancel_subagent', 'steer_subagent']) {
      expect(PASSTHROUGH_COMMANDS.has(command)).toBe(true);
    }
    // Commands the dispatcher handles itself must NOT be passthrough, or their
    // argument handling would be bypassed by the verbatim forward.
    for (const command of ['prompt', 'get_state', 'set_model', 'set_fast_mode', 'compact', 'bash', 'get_commands']) {
      expect(PASSTHROUGH_COMMANDS.has(command)).toBe(false);
    }
  });

  test('observer-only commands are a subset of passthrough', () => {
    expect([...OBSERVER_ONLY_COMMANDS].sort()).toEqual(['get_subagent_messages', 'get_subagents']);
    for (const command of OBSERVER_ONLY_COMMANDS) expect(PASSTHROUGH_COMMANDS.has(command)).toBe(true);
  });

  test('conversation-moving commands are dispatched, never forwarded verbatim', () => {
    expect([...CONVERSATION_MOVING_COMMANDS].sort()).toEqual(['branch', 'handoff', 'new_session', 'switch_session']);
    for (const command of CONVERSATION_MOVING_COMMANDS) expect(PASSTHROUGH_COMMANDS.has(command)).toBe(false);
  });

  test('image-bearing commands and answerable UI methods', () => {
    expect([...IMAGE_BEARING_COMMANDS].sort()).toEqual(['abort_and_prompt', 'follow_up', 'prompt', 'steer']);
    // `ask` is the grouped dialog `configureChild` opts into with
    // `set_ask_dialog`: omp parks the tool call on it exactly as it does on a
    // `select`, so a list without it leaves the frame unremembered and the
    // question unanswerable after a reload.
    expect(Object.keys(ANSWERABLE_UI_METHODS).sort()).toEqual(['ask', 'confirm', 'editor', 'input', 'select']);
    // Fire-and-forget methods must never block a turn waiting for a response.
    expect(ANSWERABLE_UI_METHODS.notify).toBeUndefined();
    expect(ANSWERABLE_UI_METHODS.cancel).toBeUndefined();
  });
});

describe('validateAgentImages', () => {
  test('absent images are allowed, non-arrays are not', () => {
    expect(validateAgentImages(undefined)).toBeNull();
    expect(validateAgentImages('nope')).toBe('images must be an array');
    expect(validateAgentImages({ data: 'x', mimeType: 'image/png' })).toBe('images must be an array');
  });

  test('more than the maximum count is refused by count alone', () => {
    expect(MAX_ATTACHED_IMAGES).toBe(20);
    const images = Array.from({ length: MAX_ATTACHED_IMAGES + 1 }, () => ({ data: 'AAAA', mimeType: 'image/png' }));
    expect(validateAgentImages(images)).toBe(`Maximum of ${MAX_ATTACHED_IMAGES} attached images reached.`);
  });

  test('malformed entries are refused', () => {
    expect(validateAgentImages([null])).toBe('invalid image entry');
    expect(validateAgentImages([{ data: 1, mimeType: 'image/png' }])).toBe('invalid image entry');
    expect(validateAgentImages([{ data: 'AAAA' }])).toBe('invalid image entry');
  });

  test('a valid single image passes and its size is measured from the base64 body', () => {
    expect(MAX_ATTACHED_IMAGE_BYTES).toBe(20 * 1024 * 1024);
    expect(validateAgentImages([{ data: 'AAAA', mimeType: 'image/png' }])).toBeNull();
  });

  test('a single image over the per-image limit is refused', () => {
    // 21 MiB of decoded bytes: over the 20 MB cap, still a legal base64 body.
    const data = 'A'.repeat(4 * Math.ceil((21 * 1024 * 1024) / 3));
    expect(validateAgentImages([{ data, mimeType: 'image/png' }])).toBe('Images up to 20 MB are supported.');
  });

  test('the aggregate limit is checked across individually-legal images', () => {
    expect(MAX_AGGREGATE_IMAGE_BYTES).toBe(40 * 1024 * 1024);
    // Three ~14 MiB images: each is under the per-image cap, the sum is not.
    const data = 'A'.repeat(4 * Math.ceil((14 * 1024 * 1024) / 3));
    const images = Array.from({ length: 3 }, () => ({ data, mimeType: 'image/png' }));
    expect(validateAgentImages(images)).toBe('Total image size exceeds the supported limit.');
  });
});

describe('toImageContents', () => {
  test('omits an empty or absent list so the wire payload carries no images key', () => {
    expect(toImageContents(undefined)).toBeUndefined();
    expect(toImageContents([])).toBeUndefined();
  });

  test('passes a non-empty list through by reference', () => {
    const images = [{ type: 'image' as const, data: 'AAAA', mimeType: 'image/png' }];
    expect(toImageContents(images)).toBe(images);
  });
});

describe('resolveSpawnCwd', () => {
  test('a recorded cwd that still exists is used verbatim', async () => {
    const dir = tempDir();
    expect(await resolveSpawnCwd(dir)).toBe(dir);
  });

  test('a deleted recorded cwd falls back to the server cwd', async () => {
    const dir = tempDir();
    rmSync(dir, { recursive: true, force: true });
    expect(await resolveSpawnCwd(dir)).toBe(process.cwd());
    expect(await resolveSpawnCwd(null)).toBe(process.cwd());
    expect(await resolveSpawnCwd(undefined)).toBe(process.cwd());
  });
});

describe('buildSessionSpawnArgs', () => {
  test('the title-model overlay, then the resume file, approval mode and extension load', () => {
    expect(buildSessionSpawnArgs('/tmp/session.jsonl', 'yolo')).toEqual([
      '--config',
      titleModelOverlayPath(),
      '--resume',
      '/tmp/session.jsonl',
      '--approval-mode',
      'yolo',
      ...chamberExtensionArgs(),
    ]);
  });

  test('an approval mode is passed without a resume file', () => {
    expect(buildSessionSpawnArgs('', 'write')).toEqual([
      '--config',
      titleModelOverlayPath(),
      '--approval-mode',
      'write',
      ...chamberExtensionArgs(),
    ]);
  });

  test('a new session still gets the overlay and the extension load', () => {
    expect(buildSessionSpawnArgs('')).toEqual(['--config', titleModelOverlayPath(), ...chamberExtensionArgs()]);
  });

  test('the overlay file EXISTS by the time the argv names it', () => {
    // omp's `--config` loader is strict: a missing file is a hard error, so the
    // file has to be there before the spawn reads the argv.
    const args = buildSessionSpawnArgs('');
    const path = args[args.indexOf('--config') + 1];
    expect(path).toBe(titleModelOverlayPath());
    expect(existsSync(path)).toBe(true);
  });

  test('the extension load is the `-e <existing absolute file>` pair', () => {
    const args = chamberExtensionArgs();
    expect(args.length === 0 || args[0] === '-e').toBe(true);
    if (args.length > 0) expect(args[1].startsWith('/')).toBe(true);
  });
});
