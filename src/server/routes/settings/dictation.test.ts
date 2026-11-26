/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The dictation settings route and the credential file it owns.
 *
 * The rule this file exists for is the one a refactor would quietly break: the
 * KEY NEVER LEAVES THE SERVER. A GET answers `hasApiKey`; no response body may
 * contain the secret, and the file it lives in is 0600. Both are pinned here
 * because the settings blob is injected into the page, so a key that migrated
 * into it would be readable by any script on the origin.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb } from '@/server/db.server';
import { mergeSettingsJson } from '@kabmo-labs/kabmo-settings-store';
import { getDictationSecretPath } from '@kabmo-labs/kabmo-paths/paths';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';
import { loader, action } from '@/server/routes/settings/dictation';

let dataDir = '';

const API = 'http://localhost/api/settings/dictation';

function post(body: unknown, origin = 'http://localhost'): Request {
  return new Request(API, {
    method: 'POST',
    // A browser always sends both; the origin check compares them.
    headers: { 'content-type': 'application/json', origin, host: 'localhost' },
    body: JSON.stringify(body),
  });
}

async function readJson(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

/** `action` is typed `unknown` by the route adapter; this narrows it once. */
async function runAction(body: unknown, origin?: string): Promise<Response> {
  return (await action({ request: post(body, origin), params: {} } as never)) as Response;
}

beforeEach(async () => {
  await isolateDb();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-dictation-'));
  Bun.env.KABMO_DATA_DIR = dataDir;
  delete Bun.env.MOCK;
});

afterEach(async () => {
  delete Bun.env.KABMO_DATA_DIR;
  removeDir(dataDir);
  await releaseDb();
});

describe('the credential file', () => {
  test('is written 0600 and read back, then removed on clear', async () => {
    const saved = await runAction({ apiKey: 'sk-secret' });
    expect(saved.status).toBe(200);
    expect(await readJson(saved)).toEqual({ success: true, hasApiKey: true });

    const file = getDictationSecretPath();
    expect(fs.existsSync(file)).toBe(true);
    // Windows synthesises the mode; the claim is POSIX-only.
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }

    const cleared = await runAction({ action: 'clear-key' });
    expect(await readJson(cleared)).toEqual({ success: true, hasApiKey: false });
    expect(fs.existsSync(file)).toBe(false);
  });

  test('a key is trimmed, and an empty one is refused', async () => {
    const empty = await runAction({ apiKey: '   ' });
    expect(empty.status).toBe(400);
    expect(fs.existsSync(getDictationSecretPath())).toBe(false);

    await runAction({ apiKey: '  sk-padded  ' });
    const stored = JSON.parse(fs.readFileSync(getDictationSecretPath(), 'utf8'));
    expect(stored.apiKey).toBe('sk-padded');
  });

  test('a credential past the length bound is refused before writing', async () => {
    const response = await runAction({ apiKey: 'x'.repeat(600) });
    expect(response.status).toBe(400);
    expect(fs.existsSync(getDictationSecretPath())).toBe(false);
  });
});

describe('the route', () => {
  test('GET reports hasApiKey and never the key itself', async () => {
    await runAction({ apiKey: 'sk-top-secret' });

    const response = await loader({ request: new Request(API) } as never);
    const text = await response.text();

    expect(text).not.toContain('sk-top-secret');
    const body = JSON.parse(text);
    expect(body.settings.hasApiKey).toBe(true);
    expect(body.settings).not.toHaveProperty('apiKey');
    expect(typeof body.local.available).toBe('boolean');
  });

  test('a cross-origin write is refused, so another page cannot install a key', async () => {
    const response = await runAction({ apiKey: 'sk-evil' }, 'https://evil.example');
    expect(response.status).toBe(403);
    expect(fs.existsSync(getDictationSecretPath())).toBe(false);
  });

  test('a non-POST verb is 405 through the shared route adapter', async () => {
    const response = (await action({ request: new Request(API), params: {} } as never)) as Response;
    expect(response.status).toBe(405);
  });

  test('an unknown body is refused instead of reporting success', async () => {
    const response = await runAction({ action: 'nonsense' });
    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toContain('Unknown dictation action');
  });

  test('GET reflects the stored preference, normalised', async () => {
    const db = await getDb();
    await mergeSettingsJson(db, 'kabmo_settings', {
      dictation: { engine: 'openai', language: 'id', model: 'whisper-1', baseUrl: 'https://x/v1' },
    });

    const body = await readJson(await loader({ request: new Request(API) } as never));
    expect(body.settings.engine).toBe('openai');
    expect(body.settings.language).toBe('id');
    expect(body.settings.model).toBe('whisper-1');
  });
});