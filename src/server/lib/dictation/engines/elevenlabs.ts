/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * ElevenLabs' create-transcript dialect: multipart to
 * `https://api.elevenlabs.io/v1/speech-to-text`, `xi-api-key` auth, `{text}`
 * back.
 *
 * The `model_id` and `language_code` field names are ElevenLabs' own (not
 * `model`/`language`), which is the whole reason this is a separate adapter
 * rather than a preset of the [OI] one.
 */

import { encodeWav } from '@/shared/lib/dictation/wav';
import {
  postAudio,
  readTranscript,
  requireApiKey,
  type EngineTranscribeInput,
} from '@/server/lib/dictation/engines/adapter';

const LABEL = 'ElevenLabs';
const ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text';

/** The multipart body, built separately so a test can assert its fields. */
export function elevenLabsTranscriptionForm(input: EngineTranscribeInput): FormData {
  const form = new FormData();
  form.append('file', new Blob([encodeWav(input.pcm16)], { type: 'audio/wav' }), 'utterance.wav');
  form.append('model_id', input.model);
  if (input.language) form.append('language_code', input.language);
  return form;
}

export async function transcribeWithElevenLabs(input: EngineTranscribeInput): Promise<string> {
  const apiKey = requireApiKey(LABEL, input.apiKey);
  const response = await postAudio(LABEL, ENDPOINT, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: elevenLabsTranscriptionForm(input),
  });
  return readTranscript(response);
}
