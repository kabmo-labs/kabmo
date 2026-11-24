/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The provider dialects: the URL each one reaches, the body it sends, and the
 * sentence a refusal becomes.
 *
 * The pure builders are asserted directly; `postSpeech` is exercised against a
 * fake fetch so a 401 and a 429 cannot collapse into the same generic error.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  postSpeech,
  readAudio,
  requireApiKey,
  TtsEngineError,
} from '@/server/lib/tts/engines/adapter';
import { openAiSpeechBody } from '@/server/lib/tts/engines/openai';
import { elevenLabsBody, elevenLabsUrl } from '@/server/lib/tts/engines/elevenlabs';
import { deepgramUrl } from '@/server/lib/tts/engines/deepgram';
import { xaiBody } from '@/server/lib/tts/engines/xai';
import { buildSayArgs } from '@/server/lib/tts/local.server';

const INPUT = {
  text: 'Hello world.',
  model: 'model',
  voice: 'voice',
  language: 'auto',
  baseUrl: 'https://api.example',
  speed: 1,
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('request builders', () => {
  test('OpenAI sends mp3 and omits the default speed', () => {
    expect(openAiSpeechBody(INPUT)).toEqual({
      model: 'model',
      input: 'Hello world.',
      voice: 'voice',
      response_format: 'mp3',
    });
    expect(openAiSpeechBody({ ...INPUT, speed: 1.2 })).toMatchObject({ speed: 1.2 });
  });

  test('OpenAI carries the language as an instruction only where the model documents it', () => {
    expect(openAiSpeechBody({ ...INPUT, model: 'gpt-4o-mini-tts', language: 'id' }))
      .toMatchObject({ instructions: 'Speak in Indonesian.' });
    expect(openAiSpeechBody({ ...INPUT, model: 'tts-1', language: 'id' })).not.toHaveProperty('instructions');
    expect(openAiSpeechBody({ ...INPUT, model: 'gpt-4o-mini-tts', language: '' })).not.toHaveProperty('instructions');
  });

  test('ElevenLabs puts the voice in the path and pins the format', () => {
    expect(elevenLabsUrl('https://api.elevenlabs.io/', 'voice id')).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice%20id?output_format=mp3_44100_128',
    );
    expect(elevenLabsBody(INPUT)).toEqual({ text: 'Hello world.', model_id: 'model' });
    expect(elevenLabsBody({ ...INPUT, model: 'eleven_flash_v2_5', language: 'id' }))
      .toMatchObject({ language_code: 'id' });
    expect(elevenLabsBody({ ...INPUT, model: 'eleven_multilingual_v2', language: 'id' }))
      .not.toHaveProperty('language_code');
  });

  test('Deepgram pins encoding and container, which its defaults get wrong together', () => {
    const url = new URL(deepgramUrl('https://api.deepgram.com', 'aura-2-thalia-en', 1));
    expect(url.pathname).toBe('/v1/speak');
    expect(url.searchParams.get('model')).toBe('aura-2-thalia-en');
    expect(url.searchParams.get('encoding')).toBe('mp3');
    expect(url.searchParams.get('container')).toBe('none');
    expect(url.searchParams.has('speed')).toBe(false);
    expect(new URL(deepgramUrl('https://api.deepgram.com', 'm', 1.2)).searchParams.get('speed')).toBe('1.2');
  });

  test('xAI always carries a language, defaulting to auto', () => {
    expect(xaiBody({ ...INPUT, language: '' })).toMatchObject({ language: 'auto', voice_id: 'voice' });
    expect(xaiBody({ ...INPUT, language: 'id' })).toMatchObject({ language: 'id' });
  });

  test('the local argv uses a file, never the text as an argument', () => {
    expect(buildSayArgs('/usr/bin/omp', '/tmp/in.txt', '/tmp/out.wav', 'harper', 1)).toEqual([
      '/usr/bin/omp', 'say', '--file', '/tmp/in.txt', '--out', '/tmp/out.wav', '--voice', 'harper',
    ]);
    expect(buildSayArgs('/usr/bin/omp', 'in', 'out', '', 1.2)).toEqual([
      '/usr/bin/omp', 'say', '--file', 'in', '--out', 'out', '--speed', '1.2',
    ]);
  });
});

describe('failure mapping', () => {
  test('a rejected key is not retryable and keeps the provider message', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    const error = await postSpeech('xAI', 'https://api.x.ai/v1/tts', {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TtsEngineError);
    expect((error as TtsEngineError).retryable).toBe(false);
    expect((error as TtsEngineError).message).toContain('rejected the API key');
    expect((error as TtsEngineError).message).toContain('bad key');
  });

  test('a rate limit is retryable', async () => {
    globalThis.fetch = (async () => new Response('slow down', { status: 429 })) as unknown as typeof fetch;
    const error = await postSpeech('Deepgram', 'https://api.deepgram.com/v1/speak', {}).catch((caught: unknown) => caught);
    expect((error as TtsEngineError).retryable).toBe(true);
    expect((error as TtsEngineError).message).toContain('rate-limited');
  });

  test('a key is required and the refusal names the settings page', () => {
    const error = (() => {
      try {
        requireApiKey('ElevenLabs', '  ');
        return null;
      } catch (caught) {
        return caught as TtsEngineError;
      }
    })();
    expect(error).toBeInstanceOf(TtsEngineError);
    expect(error?.message).toContain('Settings → Voice');
  });

  test('audio bytes keep the provider type and refuse an empty body', async () => {
    const audio = await readAudio(new Response(new Uint8Array([9]), {
      headers: { 'content-type': 'audio/wav; charset=binary' },
    }), 'audio/mpeg');
    expect(audio.mimeType).toBe('audio/wav');
    expect([...audio.bytes]).toEqual([9]);

    const empty = await readAudio(new Response(new Uint8Array()), 'audio/mpeg').catch((caught: unknown) => caught);
    expect(empty).toBeInstanceOf(TtsEngineError);
  });
});
