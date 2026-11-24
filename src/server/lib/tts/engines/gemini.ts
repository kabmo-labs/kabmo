/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Google Gemini TTS via the Interactions API.
 *
 * Unlike the OpenAI-shaped providers this one answers JSON with base64 audio,
 * not raw bytes, so the adapter owns the extraction. The model detects the
 * answer's language from the text — Indonesian is in its supported set — and
 * there is no speaking-rate field; `speed` is deliberately ignored.
 *
 * The free tier is real (input and output free of charge, rate-limited), which
 * is why this engine exists beside the paid hosts.
 */

import {
  postSpeech,
  requireApiKey,
  TtsEngineError,
  type TtsAudio,
  type TtsSynthInput,
} from '@/server/lib/tts/engines/adapter';

const LABEL = 'Google Gemini';

export function geminiUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/v1beta/interactions`;
}

export function geminiBody(input: TtsSynthInput): Record<string, unknown> {
  return {
    model: input.model,
    input: [{
      type: 'user_input',
      content: [{ type: 'text', text: input.text }],
    }],
    response_format: { type: 'audio' },
    generation_config: {
      speech_config: [{ voice: input.voice || 'Kore' }],
    },
  };
}

interface GeminiAudio {
  data: string;
  mimeType: string;
}

/**
 * The first audio block anywhere under `model_output`.
 *
 * The Interactions response nests content under `steps[]`, and an SDK helper
 * flattens it to `output_audio`; both shapes are accepted so a version bump on
 * either side does not turn a working answer into "no audio".
 */
export function geminiAudioFrom(payload: unknown, depth = 0): GeminiAudio | null {
  if (depth > 8) return null;
  if (Array.isArray(payload)) {
    for (let index = payload.length - 1; index >= 0; index -= 1) {
      const found = geminiAudioFrom(payload[index], depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (record.type === 'audio' && typeof record.data === 'string' && record.data) {
    return {
      data: record.data,
      mimeType: typeof record.mime_type === 'string' ? record.mime_type : 'audio/wav',
    };
  }
  const outputAudio = record.output_audio;
  if (typeof outputAudio === 'object' && outputAudio !== null) {
    const audio = outputAudio as Record<string, unknown>;
    if (typeof audio.data === 'string' && audio.data) {
      return {
        data: audio.data,
        mimeType: typeof audio.mime_type === 'string' ? audio.mime_type : 'audio/wav',
      };
    }
  }
  for (const value of Object.values(record)) {
    const found = geminiAudioFrom(value, depth + 1);
    if (found) return found;
  }
  return null;
}

export async function synthesizeWithGemini(input: TtsSynthInput): Promise<TtsAudio> {
  const apiKey = requireApiKey(LABEL, input.apiKey);
  const response = await postSpeech(LABEL, geminiUrl(input.baseUrl), {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(geminiBody(input)),
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new TtsEngineError('Google Gemini returned a response this build could not read.', true);
  }

  const audio = geminiAudioFrom(payload);
  if (!audio) throw new TtsEngineError('Google Gemini returned no audio.', true);

  const bytes = new Uint8Array(Buffer.from(audio.data, 'base64'));
  if (bytes.byteLength === 0) throw new TtsEngineError('Google Gemini returned empty audio.', true);
  return { bytes, mimeType: audio.mimeType };
}
