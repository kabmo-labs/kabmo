/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Deepgram Aura: `POST /v1/speak?model=...` with `Authorization: Token`, raw
 * audio back. Aura's model id IS the voice (`aura-2-thalia-en`), which is why
 * the settings page offers models and no separate voice list.
 *
 * The container and encoding are pinned explicitly. The API defaults are
 * `container=wav` with `encoding=mp3`, a pair that is not a playable file; a
 * request that names both leaves nothing to infer.
 */

import {
  postSpeech,
  readAudio,
  requireApiKey,
  type TtsAudio,
  type TtsSynthInput,
} from '@/server/lib/tts/engines/adapter';

const LABEL = 'Deepgram';

export function deepgramUrl(baseUrl: string, model: string, speed: number): string {
  const params = new URLSearchParams({ model, encoding: 'mp3', container: 'none' });
  if (speed !== 1) params.set('speed', String(speed));
  return `${baseUrl.replace(/\/+$/, '')}/v1/speak?${params.toString()}`;
}

export async function synthesizeWithDeepgram(input: TtsSynthInput): Promise<TtsAudio> {
  const apiKey = requireApiKey(LABEL, input.apiKey);
  const response = await postSpeech(LABEL, deepgramUrl(input.baseUrl, input.model, input.speed), {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: input.text }),
  });
  return readAudio(response, 'audio/mpeg');
}
