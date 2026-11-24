/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The synthesis route: one request, audio bytes back, and a refusal that names
 * the reason instead of a silent failure.
 *
 * The provider is mocked. What is pinned here is Kabmo's own contract — the
 * body it builds, where the key came from, the input ceiling, and the fact that
 * a cross-origin POST cannot spend the account's money.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';
import { writeTtsApiKey } from '@/server/lib/tts/settings.server';
import { action } from '@/server/routes/tts/speak';

let dataDir = '';
let calls: Array<{ url: string; init?: RequestInit }> = [];
const originalFetch = globalThis.fetch;

const API = 'http://localhost/api/tts/speak';

function post(body: unknown, origin = 'http://localhost'): Request {
  return new Request(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, host: 'localhost' },
    body: JSON.stringify(body),
  });
}

async function run(body: unknown, origin?: string): Promise<Response> {
  return (await action({ request: post(body, origin), params: {} } as never)) as Response;
}

function stubFetch(respond: () => Response): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return respond();
  }) as typeof fetch;
}

beforeEach(async () => {
  await isolateDb();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-speak-'));
  Bun.env.KABMO_DATA_DIR = dataDir;
  delete Bun.env.MOCK;
  calls = [];
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  delete Bun.env.KABMO_DATA_DIR;
  removeDir(dataDir);
  await releaseDb();
});

describe('POST /api/tts/speak', () => {
  test('sends the configured engine the configured body and returns its audio', async () => {
    await writeTtsApiKey('openai', 'sk-test');
    stubFetch(() => new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'audio/mpeg' },
    }));

    const response = await run({
      text: 'Hello from the answer.',
      config: {
        engine: 'openai',
        model: 'tts-1',
        voice: 'alloy',
        speed: 1,
        baseUrl: 'https://api.example/v1',
        language: '',
        autoplay: false,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.example/v1/audio/speech');
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get('authorization')).toBe('Bearer sk-test');
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      model: 'tts-1',
      voice: 'alloy',
      input: 'Hello from the answer.',
      response_format: 'mp3',
    });
  });

  test('refuses an input past the engine budget before calling the provider', async () => {
    await writeTtsApiKey('openai', 'sk-test');
    stubFetch(() => new Response('never', { status: 500 }));

    const response = await run({
      text: 'x'.repeat(4097),
      config: { engine: 'openai', model: 'tts-1', voice: 'alloy', speed: 1 },
    });

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(String((await response.json()).error)).toContain('4096');
  });

  test('a missing key is a sentence pointing at Settings, not a request', async () => {
    stubFetch(() => new Response('never', { status: 500 }));

    const response = await run({
      text: 'Hello.',
      config: { engine: 'elevenlabs', model: 'eleven_multilingual_v2', voice: '21m00Tcm4TlvDq8ikWAM', speed: 1 },
    });

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(String((await response.json()).error)).toContain('Settings → Voice');
  });

  test('a cross-origin request is refused', async () => {
    const response = await run({ text: 'Hello.' }, 'https://evil.example');
    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  test('a non-POST verb is 405', async () => {
    const response = (await action({ request: new Request(API), params: {} } as never)) as Response;
    expect(response.status).toBe(405);
  });

  test('an empty answer is refused', async () => {
    const response = await run({ text: '   ' });
    expect(response.status).toBe(400);
  });

  test('a provider refusal keeps the provider status in words', async () => {
    await writeTtsApiKey('openai', 'sk-bad');
    stubFetch(() => new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }));

    const response = await run({
      text: 'Hello.',
      config: { engine: 'openai', model: 'tts-1', voice: 'alloy', speed: 1 },
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('rejected the API key');
    expect(body.error).toContain('Incorrect API key provided');
    expect(body.retryable).toBe(false);
  });
});
