/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Dictation WebSocket: one utterance in, one transcript out, with model
 * download progress pushed while a local first-run decode waits on a fetch.
 *
 * The engine, the language and the model are fixed BEFORE the recording starts
 * and arrive in the query string, so an unknown engine or an unusable language
 * is refused at the upgrade instead of after a minute of audio. The audio itself
 * is the single binary frame that follows — base64 in JSON cost a third more
 * bytes and two conversions for nothing.
 *
 * Per-connection state lives on `ws.data`, not in a `WeakMap` keyed by the
 * `ws` object — Elysia hands a different wrapper to `message`/`close` than the
 * one `open` received (the same trap `terminal/ws.ts` documents).
 */

import { Elysia } from 'elysia';
import { isSameOriginUpgrade } from '@/server/lib/http/same-origin';
import { dictationEngine, resolveDictationModel } from '@/shared/lib/dictation/engines';
import { resolveDictationTag } from '@/shared/lib/dictation/languages';
import { readDictationConfig, readDictationApiKey } from '@/server/lib/dictation/settings.server';
import { localDictationCapability } from '@/server/lib/dictation/capability.server';
import { readOmpSttLanguage } from '@/server/lib/dictation/language.server';
import { transcribeWithEngine } from '@/server/lib/dictation/engines';
import { DictationEngineError } from '@/server/lib/dictation/engines/adapter';
import { DICTATION_NO_AUDIO, isDeadCapture, isSilent, utteranceMs } from '@/shared/lib/dictation/gate';
import { summarizeProgress, type SttProgressSummary } from '@/shared/lib/dictation/models';
import {
  DICTATION_MAX_AUDIO_BYTES,
  decodeDictationQuery,
  encodeDictationFrame,
  type DictationRequest,
  type DictationServerFrame,
} from '@/shared/lib/dictation/protocol';

interface DictationState {
  request: DictationRequest;
  /** Percent last reported, so a burst of file events does not flood the socket. */
  lastPercent: number | null;
  lastDecoding: boolean;
  /** One utterance per socket. */
  used: boolean;
}

type DictationWsData = { dictation?: DictationState };

/** Only progress that moves by a point or flips phase is worth a frame. */
function shouldEmitProgress(state: DictationState, summary: SttProgressSummary): boolean {
  if (summary.decoding !== state.lastDecoding) return true;
  // No overall figure (a per-file event): the last percent stays on screen, so
  // re-sending it would be pure noise — the download can emit hundreds of these.
  if (summary.percent === null) return false;
  if (state.lastPercent === null) return true;
  return Math.abs(summary.percent - state.lastPercent) >= 1;
}

export const dictationWsRoutes = new Elysia({ prefix: '/api/dictation' }).ws('/ws', {
  beforeHandle({ request, status }) {
    if (!isSameOriginUpgrade(request)) return status(403, 'Cross-origin dictation upgrade rejected');
  },

  open(ws) {
    (ws.data as unknown as DictationWsData).dictation = {
      request: decodeDictationQuery(ws.data.query as Record<string, unknown> | undefined),
      lastPercent: null,
      lastDecoding: false,
      used: false,
    };
    ws.send(encodeDictationFrame({ type: 'ready' }));
  },

  async message(ws, raw) {
    const state = (ws.data as unknown as DictationWsData).dictation;
    if (!state || state.used) return;

    const send = (frame: DictationServerFrame) => {
      try {
        ws.send(encodeDictationFrame(frame));
      } catch {
        // Socket closed mid-transcribe; the result is dropped with it.
      }
    };

    // The utterance is the binary frame; anything else is a protocol mistake.
    if (!(raw instanceof Uint8Array)) {
      send({ type: 'error', error: 'Expected the audio as a binary frame.', retryable: false });
      return;
    }
    if (raw.byteLength === 0) {
      send({ type: 'error', error: 'No audio was received.', retryable: true });
      return;
    }
    if (raw.byteLength > DICTATION_MAX_AUDIO_BYTES) {
      send({ type: 'error', error: 'The recording is too long.', retryable: true });
      return;
    }
    state.used = true;

    const config = await readDictationConfig();
    const engine = state.request.engine ?? config.engine;
    const spec = dictationEngine(engine);

    if (utteranceMs(raw.byteLength) < config.minMs) {
      send({
        type: 'error',
        error: `That was too short to transcribe (under ${config.minMs} ms).`,
        retryable: true,
      });
      return;
    }
    // Bit-exact zeros are a capture that delivered nothing, which is a different
    // answer from "the room was quiet" — and the one that a WebKit capture unit
    // that failed to start actually produces.
    if (isDeadCapture(raw)) {
      send({ type: 'error', error: DICTATION_NO_AUDIO, retryable: true });
      return;
    }
    if (isSilent(raw)) {
      send({ type: 'error', error: 'No speech was detected in that recording.', retryable: true });
      return;
    }

    if (engine === 'omp') {
      const capability = await localDictationCapability();
      if (!capability.available) {
        send({ type: 'error', error: capability.reason ?? 'Local speech-to-text is unavailable.', retryable: false });
        return;
      }
    }

    const apiKey = engine === 'omp' ? undefined : ((await readDictationApiKey()) ?? undefined);
    if (spec.needsKey && !apiKey) {
      send({
        type: 'error',
        error: `${spec.label} needs an API key. Add one in Settings → Dictation.`,
        retryable: false,
      });
      return;
    }

    const language = resolveDictationTag(
      engine,
      state.request.language ?? config.language,
      engine === 'omp' ? await readOmpSttLanguage() : undefined,
    );

    if (engine !== 'omp') {
      // A hosted engine has no model to download; the wait is the upload and
      // the decode, and saying so is the whole status line.
      send({ type: 'progress', percent: null, decoding: true });
    }

    try {
      const text = await transcribeWithEngine({
        engine,
        pcm16: raw,
        model: resolveDictationModel(engine, state.request.model ?? config.model),
        baseUrl: config.baseUrl,
        prompt: config.prompt,
        apiKey,
        ...(language ? { language } : {}),
        onProgress: (event) => {
          const summary = summarizeProgress(event);
          if (!shouldEmitProgress(state, summary)) return;
          state.lastPercent = summary.percent;
          state.lastDecoding = summary.decoding;
          send({ type: 'progress', ...summary });
        },
      });

      if (text.trim().length === 0) {
        send({ type: 'error', error: 'No speech detected.', retryable: true });
        return;
      }
      send({ type: 'final', text: text.trim() });
    } catch (error) {
      send({
        type: 'error',
        error: error instanceof Error ? error.message : 'Speech transcription failed.',
        retryable: error instanceof DictationEngineError ? error.retryable : true,
      });
    }
  },
});
