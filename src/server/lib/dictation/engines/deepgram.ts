/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Deepgram's pre-recorded dialect: `POST https://api.deepgram.com/v1/listen`
 * with the audio as the RAW body and the options in the query string.
 *
 * Not [OI]-shaped, which is why it is its own adapter: `Authorization: Token
 * <key>` (not Bearer), no multipart, and the transcript is nested at
 * `results.channels[0].alternatives[0].transcript`.
 *
 * `language=multi` is Deepgram's own code-switching mode, and it is the only
 * listed engine that claims it — an Indonesian sentence with English technical
 * terms is exactly the case a single hint cannot serve.
 */

import { encodeWav } from '@/shared/lib/dictation/wav';
import {
  postAudio,
  requireApiKey,
  DictationEngineError,
  type EngineTranscribeInput,
} from '@/server/lib/dictation/engines/adapter';

const LABEL = 'Deepgram';
const ENDPOINT = 'https://api.deepgram.com/v1/listen';

/** The query string; `multi` is Deepgram's code-switching mode. */
export function deepgramQuery(input: EngineTranscribeInput): URLSearchParams {
  const query = new URLSearchParams({
    model: input.model,
    smart_format: 'true',
    punctuate: 'true',
  });
  if (input.language) query.set('language', input.language);
  return query;
}

/** The transcript out of Deepgram's nested response. */
export function deepgramTranscript(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || !('results' in payload)) return '';
  const results = payload.results;
  if (typeof results !== 'object' || results === null || !('channels' in results)) return '';
  const channels = results.channels;
  if (!Array.isArray(channels) || channels.length === 0) return '';
  const first: unknown = channels[0];
  if (typeof first !== 'object' || first === null || !('alternatives' in first)) return '';
  const alternatives = first.alternatives;
  if (!Array.isArray(alternatives) || alternatives.length === 0) return '';
  const best: unknown = alternatives[0];
  if (typeof best !== 'object' || best === null || !('transcript' in best)) return '';
  return typeof best.transcript === 'string' ? best.transcript.trim() : '';
}

export async function transcribeWithDeepgram(input: EngineTranscribeInput): Promise<string> {
  const apiKey = requireApiKey(LABEL, input.apiKey);
  const query = deepgramQuery(input).toString();
  const response = await postAudio(LABEL, `${ENDPOINT}?${query}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'audio/wav',
    },
    body: encodeWav(input.pcm16),
  });

  const body = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new DictationEngineError(`${LABEL} answered a body that is not JSON.`, true);
  }
  return deepgramTranscript(payload);
}
