/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The OpenAI-compatible speech dialect: `POST {base}/audio/speech` as JSON,
 * `Authorization: Bearer`, raw audio back.
 *
 * One adapter covers OpenAI itself, Groq's Orpheus, Kokoro-FastAPI, openedai-
 * speech and any other server that speaks the same shape. OpenAI is retiring
 * this endpoint on 2027-01-06, which is why the settings page labels it as a
 * compatibility engine rather than the only choice.
 */

import { speechEndpoint, TTS_LANGUAGES } from '@/shared/lib/tts/engines';
import {
  postSpeech,
  readAudio,
  type TtsAudio,
  type TtsSynthInput,
} from '@/server/lib/tts/engines/adapter';

const LABEL = 'The speech API';

/**
 * OpenAI's Speech API has no language parameter: `gpt-4o-mini-tts` learns the
 * language from the input text and follows `instructions`, while `tts-1` has no
 * instruction channel at all. Sending the instruction only to the model that
 * documents it keeps the compatibility dialect honest for Groq and a local
 * Kokoro server too.
 */
function languageInstruction(model: string, language: string): string | null {
  if (!language || language === 'auto' || !model.includes('gpt-4o-mini-tts')) return null;
  const label = TTS_LANGUAGES.find((entry) => entry.id === language)?.label;
  return label ? `Speak in ${label}.` : null;
}

/** The JSON body, built separately so a test can assert its fields. */
export function openAiSpeechBody(input: TtsSynthInput): Record<string, unknown> {
  const instructions = languageInstruction(input.model, input.language);
  return {
    model: input.model,
    input: input.text,
    voice: input.voice,
    response_format: 'mp3',
    ...(instructions ? { instructions } : {}),
    ...(input.speed !== 1 ? { speed: input.speed } : {}),
  };
}

export async function synthesizeWithOpenAi(input: TtsSynthInput): Promise<TtsAudio> {
  // A local OpenAI-compatible server (Piper, edge-tts, Kokoro) usually has no
  // key. Sending the header only when one is configured keeps that path free;
  // OpenAI itself answers a missing key with a 401 that names the problem.
  const apiKey = (input.apiKey ?? '').trim();
  const url = speechEndpoint(input.baseUrl);
  if (!url) throw new Error('The speech API has no base URL configured.');

  const response = await postSpeech(LABEL, url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(openAiSpeechBody(input)),
  });
  return readAudio(response, 'audio/mpeg');
}
