/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Dispatch one synthesis request to the configured engine.
 *
 * Two things this owns that no adapter can:
 *
 * - **The input budget.** Each provider documents a different character limit,
 *   and the refusal must happen here — before a provider is charged — with the
 *   engine's name in the sentence.
 * - **The local engine's honest failure.** omp is a process that either answers
 *   or does not; when it does not, the user gets the reason and a pointer to
 *   Settings instead of a bare exit code.
 */

import { ttsEngine, type TtsEngine } from '@/shared/lib/tts/engines';
import { readTtsApiKey } from '@/server/lib/tts/settings.server';
import { TtsEngineError, type TtsAudio } from '@/server/lib/tts/engines/adapter';
import { synthesizeWithOpenAi } from '@/server/lib/tts/engines/openai';
import { synthesizeWithElevenLabs } from '@/server/lib/tts/engines/elevenlabs';
import { synthesizeWithDeepgram } from '@/server/lib/tts/engines/deepgram';
import { synthesizeWithXai } from '@/server/lib/tts/engines/xai';
import { synthesizeWithOmp } from '@/server/lib/tts/local.server';

export interface SynthesizeOptions {
  engine: TtsEngine;
  text: string;
  model: string;
  voice: string;
  language: string;
  baseUrl: string;
  speed: number;
}

export async function synthesizeSpeech(options: SynthesizeOptions): Promise<TtsAudio> {
  const spec = ttsEngine(options.engine);
  const text = options.text.trim();
  if (!text) throw new TtsEngineError('There is nothing to read aloud.', false);

  if (text.length > spec.maxChars) {
    throw new TtsEngineError(
      `${spec.label} accepts at most ${spec.maxChars} characters per request; this answer is longer.`,
      false,
    );
  }

  if (options.engine === 'omp') {
    return synthesizeWithOmp({ text, voice: options.voice, speed: options.speed });
  }

  const apiKey = (await readTtsApiKey(options.engine)) ?? undefined;
  const input = {
    text,
    model: options.model,
    voice: options.voice,
    language: options.language,
    baseUrl: options.baseUrl,
    speed: options.speed,
    apiKey,
  };

  switch (options.engine) {
    case 'openai':
      return synthesizeWithOpenAi(input);
    case 'elevenlabs':
      return synthesizeWithElevenLabs(input);
    case 'deepgram':
      return synthesizeWithDeepgram(input);
    case 'xai':
      return synthesizeWithXai(input);
  }
}
