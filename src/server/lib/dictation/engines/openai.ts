/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The [OI]-compatible transcription dialect: `POST {base}/audio/transcriptions`
 * as multipart, `Authorization: Bearer`, `{text}` back.
 *
 * One adapter covers [OI] itself, Groq, Mistral, a local whisper.cpp server,
 * speaches and any other server that speaks the same shape — which is why it
 * ships first: the fewest lines for the most endpoints. The language goes as
 * ISO-639-1 `language`; omitting it lets the provider detect.
 */

import { encodeWav } from '@/shared/lib/dictation/wav';
import { transcriptionEndpoint } from '@/shared/lib/dictation/settings';
import {
  postAudio,
  readTranscript,
  requireApiKey,
  type EngineTranscribeInput,
} from '@/server/lib/dictation/engines/adapter';

const LABEL = 'The transcription API';

/** The multipart body, built separately so a test can assert its fields. */
export function openAiTranscriptionForm(input: EngineTranscribeInput): FormData {
  const wav = encodeWav(input.pcm16);
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'utterance.wav');
  form.append('model', input.model);
  if (input.language) form.append('language', input.language);
  const prompt = input.prompt?.trim();
  if (prompt) form.append('prompt', prompt);
  form.append('response_format', 'json');
  return form;
}

export async function transcribeWithOpenAi(input: EngineTranscribeInput): Promise<string> {
  const apiKey = requireApiKey(LABEL, input.apiKey);
  const url = transcriptionEndpoint(input.baseUrl);
  if (!url) throw new Error('The transcription API has no base URL configured.');

  const response = await postAudio(LABEL, url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: openAiTranscriptionForm(input),
  });
  return readTranscript(response);
}
