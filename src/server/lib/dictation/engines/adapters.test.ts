/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The hosted adapters, against a stubbed `fetch`.
 *
 * What is pinned is what each provider actually reads: the field NAMES (ElevenLabs
 * wants `model_id`/`language_code`, [OI] wants `model`/`language`), the auth header
 * spelling (`Bearer` vs `Token` vs `xi-api-key`), the transcript's place in the
 * response, and the sentence a failure produces. A wrong field name is a 400 the
 * user sees as "the key was rejected", which is the kind of misdiagnosis this file
 * exists to prevent.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { transcribeWithOpenAi, openAiTranscriptionForm } from '@/server/lib/dictation/engines/openai';
import { deepgramQuery, deepgramTranscript, transcribeWithDeepgram } from '@/server/lib/dictation/engines/deepgram';
import { elevenLabsTranscriptionForm, transcribeWithElevenLabs } from '@/server/lib/dictation/engines/elevenlabs';
import { transcribeWithEngine } from '@/server/lib/dictation/engines';
import { DictationEngineError } from '@/server/lib/dictation/engines/adapter';

const PCM = new Uint8Array([0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x04, 0x00]);

const originalFetch = globalThis.fetch;

interface Captured {
  url: string;
  init: RequestInit;
}

/** Replace `fetch` with one answer, and record what the adapter sent. */
function stubFetch(answer: () => Response): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return answer();
  }) as typeof fetch;
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('the [OI]-compatible adapter', () => {
  test('posts multipart to {base}/audio/transcriptions with the model and language', async () => {
    const calls = stubFetch(() => jsonResponse({ text: 'halo dunia' }));

    const text = await transcribeWithOpenAi({
      pcm16: PCM,
      model: 'whisper-1',
      language: 'id',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: 'key-123',
    });

    expect(text).toBe('halo dunia');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Bearer key-123');

    const form = calls[0].init.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('language')).toBe('id');
    expect(form.get('response_format')).toBe('json');
    expect((form.get('file') as File).name).toBe('utterance.wav');
  });

  test('omits the language when there is none, so the provider detects', () => {
    const form = openAiTranscriptionForm({ pcm16: PCM, model: 'whisper-1', baseUrl: 'x' });
    expect(form.get('language')).toBeNull();
  });

  test('carries the vocabulary prompt only when it is set', () => {
    const withPrompt = openAiTranscriptionForm({ pcm16: PCM, model: 'm', baseUrl: 'x', prompt: 'Kabmo, omp' });
    expect(withPrompt.get('prompt')).toBe('Kabmo, omp');
    const blank = openAiTranscriptionForm({ pcm16: PCM, model: 'm', baseUrl: 'x', prompt: '   ' });
    expect(blank.get('prompt')).toBeNull();
  });

  test('accepts a plain-text body, which compatible servers return', async () => {
    stubFetch(() => new Response('halo dunia', { status: 200, headers: { 'content-type': 'text/plain' } }));
    const text = await transcribeWithOpenAi({ pcm16: PCM, model: 'm', baseUrl: 'https://x/v1', apiKey: 'k' });
    expect(text).toBe('halo dunia');
  });

  test('a rejected key names the key, not the model', async () => {
    stubFetch(() => jsonResponse({ error: { message: 'Incorrect API key provided' } }, 401));
    const error = await transcribeWithOpenAi({ pcm16: PCM, model: 'm', baseUrl: 'https://x/v1', apiKey: 'bad' })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DictationEngineError);
    expect((error as Error).message).toContain('rejected the API key');
    expect((error as Error).message).toContain('Incorrect API key provided');
    // The key itself must never appear in a message the browser renders.
    expect((error as Error).message).not.toContain('bad');
  });

  test('no key is refused before any request is made', async () => {
    const calls = stubFetch(() => jsonResponse({ text: 'x' }));
    const error = await transcribeWithOpenAi({ pcm16: PCM, model: 'm', baseUrl: 'https://x/v1' })
      .catch((cause: unknown) => cause);
    expect((error as Error).message).toContain('needs an API key');
    expect(calls).toHaveLength(0);
  });
});

describe('the Deepgram adapter', () => {
  test('sends the raw WAV with Token auth and the options in the query', async () => {
    const calls = stubFetch(() => jsonResponse({
      results: { channels: [{ alternatives: [{ transcript: 'halo dunia' }] }] },
    }));

    const text = await transcribeWithDeepgram({
      pcm16: PCM,
      model: 'nova-3',
      language: 'id',
      baseUrl: '',
      apiKey: 'dg-key',
    });

    expect(text).toBe('halo dunia');
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe('https://api.deepgram.com/v1/listen');
    expect(url.searchParams.get('model')).toBe('nova-3');
    expect(url.searchParams.get('language')).toBe('id');
    expect(url.searchParams.get('smart_format')).toBe('true');
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Token dg-key');
    expect(new Headers(calls[0].init.headers).get('content-type')).toBe('audio/wav');
  });

  test('the query omits the language when the engine should detect', () => {
    expect(deepgramQuery({ pcm16: PCM, model: 'nova-3', baseUrl: '' }).get('language')).toBeNull();
  });

  test('reads the transcript out of its nested response', () => {
    expect(deepgramTranscript({ results: { channels: [{ alternatives: [{ transcript: ' hi ' }] }] } })).toBe('hi');
  });

  test('a shape without a transcript is empty rather than a crash', () => {
    expect(deepgramTranscript(null)).toBe('');
    expect(deepgramTranscript({})).toBe('');
    expect(deepgramTranscript({ results: { channels: [] } })).toBe('');
    expect(deepgramTranscript({ results: { channels: [{ alternatives: [{ transcript: 42 }] }] } })).toBe('');
  });
});

describe('the ElevenLabs adapter', () => {
  test('uses its own field names and the xi-api-key header', async () => {
    const calls = stubFetch(() => jsonResponse({ text: 'halo dunia' }));

    const text = await transcribeWithElevenLabs({
      pcm16: PCM,
      model: 'scribe_v2',
      language: 'id',
      baseUrl: '',
      apiKey: 'el-key',
    });

    expect(text).toBe('halo dunia');
    expect(calls[0].url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    expect(new Headers(calls[0].init.headers).get('xi-api-key')).toBe('el-key');
    const form = calls[0].init.body as FormData;
    expect(form.get('model_id')).toBe('scribe_v2');
    expect(form.get('language_code')).toBe('id');
  });

  test('the form carries no [OI] field names', () => {
    const form = elevenLabsTranscriptionForm({ pcm16: PCM, model: 'scribe_v2', baseUrl: '' });
    expect(form.get('model')).toBeNull();
    expect(form.get('language')).toBeNull();
  });
});

describe('transcribeWithEngine', () => {
  test('refuses an upload past the engine’s documented cap, before fetching', async () => {
    const calls = stubFetch(() => jsonResponse({ text: 'x' }));
    const oversized = new Uint8Array(26 * 1024 * 1024);

    const error = await transcribeWithEngine({
      engine: 'openai',
      pcm16: oversized,
      model: 'whisper-1',
      baseUrl: 'https://x/v1',
      apiKey: 'k',
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DictationEngineError);
    expect((error as Error).message).toContain('longer than');
    expect(calls).toHaveLength(0);
  });

  test('a 429 is retryable, a 401 is not', async () => {
    stubFetch(() => jsonResponse({ error: 'slow down' }, 429));
    const rateLimited = await transcribeWithEngine({
      engine: 'openai', pcm16: PCM, model: 'm', baseUrl: 'https://x/v1', apiKey: 'k',
    }).catch((cause: unknown) => cause);
    expect((rateLimited as DictationEngineError).retryable).toBe(true);

    stubFetch(() => jsonResponse({ error: 'nope' }, 401));
    const rejected = await transcribeWithEngine({
      engine: 'openai', pcm16: PCM, model: 'm', baseUrl: 'https://x/v1', apiKey: 'k',
    }).catch((cause: unknown) => cause);
    expect((rejected as DictationEngineError).retryable).toBe(false);
  });
});
