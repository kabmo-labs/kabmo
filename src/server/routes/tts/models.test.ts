/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The local model route: what is installed, what can be installed, and the two
 * refusals that keep another page from driving it.
 *
 * The download itself is not exercised here — it is 146 MB of weights from a
 * network the test must not depend on. What is pinned is Kabmo's own contract:
 * an empty install lists the catalog, a cross-origin POST is rejected, an
 * unknown action is named, and a removal of something absent does not pretend to
 * have removed it.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';
import { action, loader } from '@/server/routes/tts/models';
import { LOCAL_TTS_CATALOG } from '@/shared/lib/tts/local-models';

let dataDir = '';
const API = 'http://localhost/api/tts/models';

function request(method: string, body?: unknown, origin = 'http://localhost'): Request {
  return new Request(API, {
    method,
    headers: { 'content-type': 'application/json', origin, host: 'localhost' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function run(body: unknown, origin?: string): Promise<Response> {
  return (await action({ request: request('POST', body, origin), params: {} } as never)) as Response;
}

async function asRecord(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json();
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

async function errorOf(response: Response): Promise<string> {
  const body = await asRecord(response);
  return typeof body.error === 'string' ? body.error : '';
}

async function modelsOf(response: Response): Promise<Record<string, unknown>[]> {
  const body = await asRecord(response);
  return Array.isArray(body.models) ? (body.models as Record<string, unknown>[]) : [];
}

beforeEach(async () => {
  await isolateDb();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-models-'));
  Bun.env.KABMO_DATA_DIR = dataDir;
});

afterEach(async () => {
  delete Bun.env.KABMO_DATA_DIR;
  removeDir(dataDir);
  await releaseDb();
});

describe('GET /api/tts/models', () => {
  test('an empty install lists the catalog and no models', async () => {
    const response = (await loader({ request: request('GET'), params: {} } as never)) as Response;
    const body = await asRecord(response);
    expect(response.status).toBe(200);
    expect(body.models).toEqual([]);
    expect((body.catalog as unknown[]).length).toBe(LOCAL_TTS_CATALOG.length);
    expect(body.runtime).toHaveProperty('available');
  });

  test('reports a ready model, without leaking its absolute directory', async () => {
    const dir = path.join(dataDir, 'tts-models', 'supertonic-3');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'model.json'), JSON.stringify({
      label: 'Supertonic 3',
      arch: 'supertonic',
      languages: ['en', 'id'],
      defaultLanguage: 'en',
      voices: 10,
      sampleRate: 44100,
      installedAt: '2026-11-25T00:00:00.000Z',
    }));

    const response = (await loader({ request: request('GET'), params: {} } as never)) as Response;
    const models = await modelsOf(response);
    expect(models).toHaveLength(1);
    expect(models[0]!.id).toBe('supertonic-3');
    expect(models[0]!.languages).toEqual(['en', 'id']);
    expect(models[0]!.voices).toBe(10);
    expect(models[0]).not.toHaveProperty('dir');
  });

  test('a directory without a manifest is not a model', async () => {
    fs.mkdirSync(path.join(dataDir, 'tts-models', 'half-installed'), { recursive: true });
    const response = (await loader({ request: request('GET'), params: {} } as never)) as Response;
    expect(await modelsOf(response)).toEqual([]);
  });
});

describe('POST /api/tts/models', () => {
  test('a cross-origin install is rejected before any download starts', async () => {
    const response = await run({ action: 'install', id: 'supertonic-3' }, 'http://evil.test');
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toContain('Cross-origin');
  });

  test('an install with neither a model nor a link is refused by name', async () => {
    const response = await run({ action: 'install' });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('paste a link');
  });

  test('a link that is not http(s) is refused rather than fetched', async () => {
    const response = await run({ action: 'install', url: 'file:///etc/passwd' });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('http or https');
  });

  test('an unknown action is named, not silently accepted', async () => {
    const response = await run({ action: 'frobnicate' });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('Unknown model action');
  });

  test('removing a model that is not there leaves the directory alone', async () => {
    const response = await run({ action: 'remove', id: 'never-installed' });
    expect(response.status).toBe(200);
    expect(fs.existsSync(path.join(dataDir, 'tts-models'))).toBe(false);
  });

  test('a model id that could escape the directory is refused', async () => {
    const response = await run({ action: 'remove', id: '../settings' });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('not a model id');
  });

  test('a busier method is answered 405, not 404', async () => {
    const response = (await action({ request: request('GET'), params: {} } as never)) as Response;
    expect(response.status).toBe(405);
  });
});
