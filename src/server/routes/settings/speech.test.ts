/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The speech settings route and the multi-engine credential file it owns.
 *
 * The rule this file exists for is the one a refactor would quietly break: NO
 * KEY LEAVES THE SERVER, and clearing one engine's key must not clear another's.
 * A GET answers `hasKeys`; the file it mirrors is 0600.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb } from '@/server/db.server';
import { mergeSettingsJson } from '@/server/lib/db/settings-store';
import { getTtsSecretPath } from '@/server/lib/lifecycle/paths';
import { invalidateLocalTtsCapability } from '@/server/lib/tts/local.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';
import { loader, action } from '@/server/routes/settings/speech';

let dataDir = '';

const API = 'http://localhost/api/settings/speech';

function post(body: unknown, origin = 'http://localhost'): Request {
  return new Request(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, host: 'localhost' },
    body: JSON.stringify(body),
  });
}

async function readJson(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

async function runAction(body: unknown, origin?: string): Promise<Response> {
  return (await action({ request: post(body, origin), params: {} } as never)) as Response;
}

beforeEach(async () => {
  await isolateDb();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-speech-'));
  Bun.env.KABMO_DATA_DIR = dataDir;
  // A missing binary answers "not available" without spawning anything.
  Bun.env.KABMO_OMP_BIN = path.join(dataDir, 'missing-omp');
  invalidateLocalTtsCapability();
  delete Bun.env.MOCK;
});

afterEach(async () => {
  delete Bun.env.KABMO_DATA_DIR;
  delete Bun.env.KABMO_OMP_BIN;
  invalidateLocalTtsCapability();
  removeDir(dataDir);
  await releaseDb();
});

describe('the credential file', () => {
  test('is written 0600 and removed on clear', async () => {
    const saved = await runAction({ engine: 'openai', apiKey: 'sk-secret' });
    expect(saved.status).toBe(200);
    expect(await readJson(saved)).toEqual({ success: true, engine: 'openai', hasKey: true });

    const file = getTtsSecretPath();
    expect(fs.existsSync(file)).toBe(true);
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }

    const cleared = await runAction({ engine: 'openai', action: 'clear-key' });
    expect(await readJson(cleared)).toEqual({ success: true, engine: 'openai', hasKey: false });
    expect(fs.existsSync(file)).toBe(false);
  });

  test('keys for different engines coexist; clearing one keeps the other', async () => {
    await runAction({ engine: 'openai', apiKey: 'sk-openai' });
    await runAction({ engine: 'elevenlabs', apiKey: 'xi-eleven' });

    const stored = JSON.parse(fs.readFileSync(getTtsSecretPath(), 'utf8'));
    expect(stored.keys).toEqual({ openai: 'sk-openai', elevenlabs: 'xi-eleven' });

    await runAction({ engine: 'openai', action: 'clear-key' });
    const after = JSON.parse(fs.readFileSync(getTtsSecretPath(), 'utf8'));
    expect(after.keys).toEqual({ elevenlabs: 'xi-eleven' });
  });

  test('an empty or oversized key is refused before writing', async () => {
    expect((await runAction({ engine: 'openai', apiKey: '   ' })).status).toBe(400);
    expect((await runAction({ engine: 'openai', apiKey: 'x'.repeat(600) })).status).toBe(400);
    expect(fs.existsSync(getTtsSecretPath())).toBe(false);
  });
});

describe('the route', () => {
  test('GET reports hasKeys and never a key', async () => {
    await runAction({ engine: 'deepgram', apiKey: 'dg-top-secret' });

    const response = await loader({ request: new Request(API) } as never);
    const text = await response.text();

    expect(text).not.toContain('dg-top-secret');
    const body = JSON.parse(text);
    expect(body.settings.hasKeys.deepgram).toBe(true);
    expect(body.settings.hasKeys.openai).toBe(false);
    expect(body.settings).not.toHaveProperty('keys');
    expect(typeof body.local.available).toBe('boolean');
  });

  test('a cross-origin write is refused', async () => {
    const response = await runAction({ engine: 'openai', apiKey: 'sk-evil' }, 'https://evil.example');
    expect(response.status).toBe(403);
    expect(fs.existsSync(getTtsSecretPath())).toBe(false);
  });

  test('the local engine cannot hold a key', async () => {
    expect((await runAction({ engine: 'omp', apiKey: 'sk-nope' })).status).toBe(400);
    expect(fs.existsSync(getTtsSecretPath())).toBe(false);
  });

  test('a non-POST verb is 405 through the shared route adapter', async () => {
    const response = (await action({ request: new Request(API), params: {} } as never)) as Response;
    expect(response.status).toBe(405);
  });

  test('an unknown body is refused instead of reporting success', async () => {
    const response = await runAction({ engine: 'openai', action: 'nonsense' });
    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toContain('Unknown speech action');
  });

  test('GET reflects the stored preference, normalised', async () => {
    const db = await getDb();
    await mergeSettingsJson(db, 'kabmo_settings', {
      tts: { engine: 'xai', voice: 'ara', speed: 9, autoplay: true },
    });

    const body = await readJson(await loader({ request: new Request(API) } as never));
    expect(body.settings.engine).toBe('xai');
    expect(body.settings.voice).toBe('ara');
    expect(body.settings.speed).toBe(1.5);
    expect(body.settings.autoplay).toBe(true);
  });

  test('the probe reports a missing omp binary without spawning', async () => {
    const body = await readJson(await runAction({ action: 'probe' }));
    expect(body.success).toBe(true);
    expect(body.local.available).toBe(false);
    expect(String(body.local.reason)).toContain('not installed');
  });
});
