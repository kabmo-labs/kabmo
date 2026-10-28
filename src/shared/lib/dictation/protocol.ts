/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Dictation WebSocket frames: the contract between the composer's mic button
 * and Kabmo's dictation route.
 *
 * One utterance per socket, and the audio travels in a SINGLE frame. The
 * alternative — streaming chunks while the user speaks — buys nothing here:
 * omp's STT is not incremental (its own TUI inserts text on release), so a
 * chunked transport would only add reordering and reassembly for a result the
 * final decode replaces. The socket exists for the other direction: the server
 * pushes model download progress while the decode waits on a first-run fetch.
 */

import { isRecord } from '@/shared/lib/util/guards';

export const DICTATION_SAMPLE_RATE = 16000;
export const DICTATION_BITS = 16;
export const DICTATION_CHANNELS = 1;
export const DICTATION_FORMAT = `audio/pcm;rate=${DICTATION_SAMPLE_RATE};bits=${DICTATION_BITS}`;

/** Cap on one utterance, so a stuck client cannot post an unbounded buffer. */
export const DICTATION_MAX_AUDIO_BYTES = 32 * 1024 * 1024;

/** Client → Server: the whole utterance, PCM16LE mono @16 kHz, base64. */
export interface DictationTranscribeFrame {
  type: 'transcribe';
  audio: string;
  modelKey?: string;
  language?: string;
}

export type DictationClientFrame = DictationTranscribeFrame;

/** Server → Client: the socket is open and ready for an utterance. */
export interface DictationReadyFrame {
  type: 'ready';
}

/** Server → Client: the model is being fetched or loaded. */
export interface DictationProgressFrame {
  type: 'progress';
  /** 0..100 while downloading, null once it is decoding. */
  percent: number | null;
  file?: string;
  decoding: boolean;
}

/** Server → Client: the transcript of the utterance just sent. */
export interface DictationFinalFrame {
  type: 'final';
  text: string;
}

/** Server → Client: the utterance could not be transcribed. */
export interface DictationErrorFrame {
  type: 'error';
  error: string;
  retryable: boolean;
}

export type DictationServerFrame =
  | DictationReadyFrame
  | DictationProgressFrame
  | DictationFinalFrame
  | DictationErrorFrame;

export function encodeDictationFrame(frame: DictationClientFrame | DictationServerFrame): string {
  return JSON.stringify(frame);
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Decode an inbound frame from whatever the socket delivered.
 *
 * Elysia hands the `message` callback an ALREADY-PARSED object when no `body`
 * schema is declared — verified: `typeof raw` is `object` and `String(raw)` is
 * `[object Object]`. Routing that through `new TextDecoder().decode(raw)`
 * yields an empty string, so a `JSON.parse` of it throws and the frame is
 * silently dropped: the client sees `ready` and then nothing, with no error on
 * either side. The terminal protocol's decoder takes the same three shapes for
 * the same reason.
 */
export function decodeDictationClientFrame(raw: unknown): DictationClientFrame | null {
  const value =
    typeof raw === 'string'
      ? tryParse(raw)
      : raw instanceof Uint8Array
        ? tryParse(new TextDecoder().decode(raw))
        : raw;
  if (!isRecord(value)) return null;
  if (value.type !== 'transcribe') return null;
  if (typeof value.audio !== 'string') return null;
  return {
    type: 'transcribe',
    audio: value.audio,
    ...(typeof value.modelKey === 'string' ? { modelKey: value.modelKey } : {}),
    ...(typeof value.language === 'string' ? { language: value.language } : {}),
  };
}
