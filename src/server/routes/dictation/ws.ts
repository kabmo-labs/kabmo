/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dictation WebSocket: one utterance in, one transcript out, with model
 * download progress pushed while the first decode waits on a fetch.
 *
 * The transcription itself is omp's own local STT — this route only owns the
 * browser half (audio bytes and progress). See `omp-stt-worker.ts` for why the
 * work happens in a spawned worker rather than the agent RPC.
 *
 * Per-connection state lives on `ws.data`, not in a `WeakMap` keyed by the
 * `ws` object — Elysia hands a different wrapper to `message`/`close` than the
 * one `open` received (the same trap `terminal/ws.ts` documents).
 */

import { Elysia } from 'elysia';
import { isSameOriginUpgrade } from '@/server/lib/http/same-origin';
import { sttWorker } from '@/server/lib/dictation/omp-stt-worker';
import { resolveDictationLanguage } from '@/server/lib/dictation/language.server';
import { pcm16ToFloat32 } from '@/shared/lib/dictation/audio';
import { summarizeProgress, type SttProgressSummary } from '@/shared/lib/dictation/models';
import {
  DICTATION_MAX_AUDIO_BYTES,
  encodeDictationFrame,
  decodeDictationClientFrame,
  type DictationServerFrame,
} from '@/shared/lib/dictation/protocol';

interface DictationState {
  /** Percent last reported, so a burst of file events does not flood the socket. */
  lastPercent: number | null;
  lastDecoding: boolean;
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
    (ws.data as unknown as DictationWsData).dictation = { lastPercent: null, lastDecoding: false };
    ws.send(encodeDictationFrame({ type: 'ready' }));
  },

  async message(ws, raw) {
    const state = (ws.data as unknown as DictationWsData).dictation;
    if (!state) return;

    const send = (frame: DictationServerFrame) => {
      try {
        ws.send(encodeDictationFrame(frame));
      } catch {
        // Socket closed mid-transcribe; the result is dropped with it.
      }
    };

    // Elysia hands this an already-parsed object (see the decoder's docs).
    const frame = decodeDictationClientFrame(raw);
    if (!frame) return;

    // base64 is 4/3 of the byte count; guard before decoding, not after.
    if (frame.audio.length > (DICTATION_MAX_AUDIO_BYTES * 4) / 3) {
      send({ type: 'error', error: 'The recording is too long.', retryable: true });
      return;
    }

    // The wire carries compact PCM16; omp's worker takes normalized Float32 and
    // rejects every other shape (see `shared/lib/dictation/audio.ts`).
    const samples = pcm16ToFloat32(new Uint8Array(Buffer.from(frame.audio, 'base64')));

    try {
      // A language the CLIENT sent wins (nothing sends one today, but the frame
      // carries the field); otherwise the session's configured `stt.language`
      // decides. An absent value means auto-detect, which is what the worker
      // does with no `language`.
      const text = await sttWorker().transcribe(samples, {
        modelKey: frame.modelKey,
        language: frame.language ?? (await resolveDictationLanguage()),
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
        retryable: true,
      });
    }
  },
});
