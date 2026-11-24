/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * xAI Grok Voice: `POST /v1/tts` with `Authorization: Bearer`, raw audio back.
 *
 * The one provider that REQUIRES a language (`auto` is its detection value), so
 * an empty setting becomes `auto` here instead of an omitted field that its API
 * rejects.
 */

import {
  postSpeech,
  readAudio,
  requireApiKey,
  type TtsAudio,
  type TtsSynthInput,
} from '@/server/lib/tts/engines/adapter';

const LABEL = 'xAI';

export function xaiBody(input: TtsSynthInput): Record<string, unknown> {
  return {
    text: input.text,
    voice_id: input.voice || 'eve',
    language: input.language || 'auto',
    ...(input.speed !== 1 ? { speed: input.speed } : {}),
  };
}

export async function synthesizeWithXai(input: TtsSynthInput): Promise<TtsAudio> {
  const apiKey = requireApiKey(LABEL, input.apiKey);
  const response = await postSpeech(LABEL, `${input.baseUrl.replace(/\/+$/, '')}/v1/tts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(xaiBody(input)),
  });
  return readAudio(response, 'audio/mpeg');
}
