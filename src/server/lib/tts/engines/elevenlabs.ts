/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * ElevenLabs: `POST /v1/text-to-speech/{voice_id}` with `xi-api-key`, raw audio
 * back. The voice id is part of the path, so an empty one is refused here with
 * a sentence rather than becoming a request to `/v1/text-to-speech/`.
 */

import {
  postSpeech,
  readAudio,
  requireApiKey,
  TtsEngineError,
  type TtsAudio,
  type TtsSynthInput,
} from '@/server/lib/tts/engines/adapter';

const LABEL = 'ElevenLabs';

export function elevenLabsUrl(baseUrl: string, voice: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`;
}

export function elevenLabsBody(input: TtsSynthInput): Record<string, unknown> {
  return {
    text: input.text,
    model_id: input.model,
    ...(input.speed !== 1 ? { voice_settings: { speed: input.speed } } : {}),
  };
}

export async function synthesizeWithElevenLabs(input: TtsSynthInput): Promise<TtsAudio> {
  const apiKey = requireApiKey(LABEL, input.apiKey);
  if (!input.voice) {
    throw new TtsEngineError(
      'ElevenLabs needs a voice id. Pick one in Settings → Voice → Speech.',
      false,
    );
  }
  const response = await postSpeech(LABEL, elevenLabsUrl(input.baseUrl, input.voice), {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(elevenLabsBody(input)),
  });
  return readAudio(response, 'audio/mpeg');
}
