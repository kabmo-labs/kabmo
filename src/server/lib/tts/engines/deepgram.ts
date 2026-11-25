/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Deepgram's pre-recorded speech, TWO endpoints selected by the model id:
 * Aura on `POST /v1/speak`, Flux on `POST /v2/speak`. An Aura id sent to v2 (or
 * a Flux id to v1) is refused, so the path is derived from the prefix, never
 * tried.
 *
 * Shared shape: the audio is the RAW response body, options travel in the query
 * string, and the model id IS the voice. Flux's id also carries the language —
 * its last segment (`flux-dewi-id` speaks Indonesian) — which is why the engine
 * has no `language` field.
 *
 * `encoding=mp3` is named and `container` is NEVER named: the API's defaults
 * pair `container=wav` with `encoding=mp3`, which is not a playable file, and
 * `container` is a 400 the moment `encoding=mp3` is set (measured on both
 * endpoints).
 */

import {
  postSpeech,
  readAudio,
  requireApiKey,
  type TtsAudio,
  type TtsSynthInput,
} from '@/server/lib/tts/engines/adapter';

const LABEL = 'Deepgram';

export function deepgramPath(model: string): '/v1/speak' | '/v2/speak' {
  return model.startsWith('flux-') ? '/v2/speak' : '/v1/speak';
}

/**
 * Flux answers `speed` only in 0.05 increments ("must be provided in
 * increments of 0.05", measured); Aura accepts any decimal inside its range.
 */
function deepgramSpeed(model: string, speed: number): string {
  return deepgramPath(model) === '/v2/speak'
    ? String(Math.round(speed * 20) / 20)
    : String(speed);
}

export function deepgramUrl(baseUrl: string, model: string, speed: number): string {
  const params = new URLSearchParams({ model, encoding: 'mp3' });
  if (speed !== 1) params.set('speed', deepgramSpeed(model, speed));
  return `${baseUrl.replace(/\/+$/, '')}${deepgramPath(model)}?${params.toString()}`;
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
