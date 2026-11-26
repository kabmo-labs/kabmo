/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `POST /api/tts/speak` — one chunk of an answer, synthesized and returned as
 * audio bytes.
 *
 * The client owns chunking because it owns playback: it can start the first
 * sentence while the next request is still in flight, and "Stop" can drop the
 * rest instantly. This route therefore refuses an oversized input instead of
 * splitting it a second way.
 *
 * The config travels in the body so a settings edit applies to the very next
 * click (the stored write is fire-and-forget) and so the settings page can test
 * a draft. The key never travels: it is resolved from the engine's own file.
 */

import { json } from '@kabmo-labs/kabmo-http';
import type { ActionFunctionArgs } from '@kabmo-labs/kabmo-http';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { isSameOriginRequest } from '@/server/lib/http/same-origin';
import { readTtsConfig } from '@/server/lib/tts/settings.server';
import { synthesizeSpeech } from '@/server/lib/tts/engines';
import { TtsEngineError } from '@/server/lib/tts/engines/adapter';
import { normalizeTtsConfig, resolveTtsRequest } from '@/shared/lib/tts/settings';

/** Absolute ceiling, on top of each engine's own budget. */
const MAX_TEXT_CHARS = 100_000;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params });
  // Synthesis spends money at a hosted provider. A cross-origin `no-cors` POST
  // could not read the audio, but could still run the bill.
  if (!isSameOriginRequest(request)) {
    return json({ error: 'Cross-origin speech request rejected' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  if (!isPlainRecord(body)) return json({ error: 'Expected a JSON object.' }, { status: 400 });

  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) return json({ error: 'There is nothing to read aloud.' }, { status: 400 });
  if (text.length > MAX_TEXT_CHARS) {
    return json({ error: 'That answer is too long to read aloud in one request.' }, { status: 413 });
  }

  try {
    const stored = await readTtsConfig();
    const config = normalizeTtsConfig({
      ...stored,
      ...(isPlainRecord(body.config) ? body.config : {}),
    });
    const requestConfig = resolveTtsRequest(config);
    const audio = await synthesizeSpeech({ ...requestConfig, text });

    return new Response(audio.bytes, {
      status: 200,
      headers: {
        'content-type': audio.mimeType,
        'cache-control': 'no-store',
        'content-length': String(audio.bytes.byteLength),
      },
    });
  } catch (error: unknown) {
    if (error instanceof TtsEngineError) {
      return json(
        { error: error.message, retryable: error.retryable },
        { status: error.retryable ? 502 : 400 },
      );
    }
    return json(
      { error: error instanceof Error ? error.message : 'Could not synthesize speech.' },
      { status: 500 },
    );
  }
}
