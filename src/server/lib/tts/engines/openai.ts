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

import { speechEndpoint } from '@/shared/lib/tts/engines';
import {
  postSpeech,
  readAudio,
  requireApiKey,
  type TtsAudio,
  type TtsSynthInput,
} from '@/server/lib/tts/engines/adapter';

const LABEL = 'The speech API';

/** The JSON body, built separately so a test can assert its fields. */
export function openAiSpeechBody(input: TtsSynthInput): Record<string, unknown> {
  return {
    model: input.model,
    input: input.text,
    voice: input.voice,
    response_format: 'mp3',
    ...(input.speed !== 1 ? { speed: input.speed } : {}),
  };
}

export async function synthesizeWithOpenAi(input: TtsSynthInput): Promise<TtsAudio> {
  const apiKey = requireApiKey(LABEL, input.apiKey);
  const url = speechEndpoint(input.baseUrl);
  if (!url) throw new Error('The speech API has no base URL configured.');

  const response = await postSpeech(LABEL, url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(openAiSpeechBody(input)),
  });
  return readAudio(response, 'audio/mpeg');
}
