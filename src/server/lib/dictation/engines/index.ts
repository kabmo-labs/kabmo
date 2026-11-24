/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Dispatch one utterance to the configured engine.
 *
 * Two things this owns that no adapter can:
 *
 * - **The byte cap.** Each provider documents its own upload limit, and the
 *   refusal must happen here — before a 30 MB buffer is encoded and uploaded —
 *   with the engine's name in the sentence.
 * - **The local engine's honest failure.** omp's worker is a process that either
 *   answers or does not; when it does not, the user gets the reason and a
 *   pointer to Settings instead of `STT worker exited.`
 */

import { dictationEngine, type DictationEngine } from '@/shared/lib/dictation/engines';
import { pcm16ToFloat32 } from '@/shared/lib/dictation/audio';
import type { SttProgressEvent } from '@/shared/lib/dictation/models';
import { sttWorker } from '@/server/lib/dictation/omp-stt-worker';
import { DictationEngineError, type EngineTranscribeInput } from '@/server/lib/dictation/engines/adapter';
import { transcribeWithOpenAi } from '@/server/lib/dictation/engines/openai';
import { transcribeWithDeepgram } from '@/server/lib/dictation/engines/deepgram';
import { transcribeWithElevenLabs } from '@/server/lib/dictation/engines/elevenlabs';

export interface TranscribeOptions extends EngineTranscribeInput {
  engine: DictationEngine;
  onProgress?: (event: SttProgressEvent) => void;
}

export async function transcribeWithEngine(options: TranscribeOptions): Promise<string> {
  const spec = dictationEngine(options.engine);

  if (options.pcm16.byteLength > spec.maxBytes) {
    const limitMb = Math.round(spec.maxBytes / (1024 * 1024));
    throw new DictationEngineError(
      `The recording is longer than ${spec.label} accepts (${limitMb} MB). Try a shorter one.`,
      false,
    );
  }

  if (options.engine === 'omp') {
    return sttWorker().transcribe(pcm16ToFloat32(options.pcm16), {
      modelKey: options.model,
      language: options.language,
      onProgress: options.onProgress,
    });
  }

  if (options.engine === 'openai') return transcribeWithOpenAi(options);
  if (options.engine === 'deepgram') return transcribeWithDeepgram(options);
  return transcribeWithElevenLabs(options);
}
