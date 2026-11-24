/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Dictation WebSocket contract: one utterance per socket, audio as ONE binary
 * frame, engine choices in the query string, JSON frames back.
 *
 * The audio used to travel as base64 inside a JSON frame. That cost a third
 * more bytes on the wire and two conversions (base64 → bytes → Float32) for no
 * benefit: the terminal socket already proves Elysia delivers a `Uint8Array`
 * client frame untouched, and the metadata is fixed before the recording
 * starts, so it belongs in the URL. The query is also where the server can
 * refuse an unknown engine before a byte of audio is buffered.
 *
 * The socket exists for the other direction: the local engine pushes model
 * download progress while a first-run decode waits on a fetch, and a hosted
 * engine reports that it is decoding.
 */

import { isDictationEngine, type DictationEngine } from '@/shared/lib/dictation/engines';
import { isDictationLanguage, type DictationLanguage } from '@/shared/lib/dictation/languages';
import { isRecord } from '@/shared/lib/util/guards';

export const DICTATION_SAMPLE_RATE = 16000;
export const DICTATION_BITS = 16;
export const DICTATION_CHANNELS = 1;

/** Cap on one utterance, so a stuck client cannot post an unbounded buffer. */
export const DICTATION_MAX_AUDIO_BYTES = 32 * 1024 * 1024;

/** Client → Server: the utterance's metadata, fixed before recording starts. */
export interface DictationRequest {
  engine?: DictationEngine;
  language?: DictationLanguage;
  model?: string;
}

/** `/api/dictation/ws?engine=…&language=…&model=…` — empty fields are omitted. */
export function dictationSocketPath(request: DictationRequest = {}): string {
  const query = new URLSearchParams();
  if (request.engine) query.set('engine', request.engine);
  if (request.language) query.set('language', request.language);
  const model = request.model?.trim();
  if (model) query.set('model', model);
  const search = query.toString();
  return `/api/dictation/ws${search ? `?${search}` : ''}`;
}

/**
 * Read the request out of a query record.
 *
 * An unknown engine or language is DROPPED rather than forwarded: the server
 * then uses the stored setting, which is a value this build understands. A
 * value passed through would reach a recognizer as a language tag.
 */
export function decodeDictationQuery(query: Record<string, unknown> | undefined): DictationRequest {
  const engine = query?.engine;
  const language = query?.language;
  const model = query?.model;
  return {
    ...(isDictationEngine(engine) ? { engine } : {}),
    ...(isDictationLanguage(language) ? { language } : {}),
    ...(typeof model === 'string' && model.trim() ? { model: model.trim().slice(0, 120) } : {}),
  };
}

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

export function encodeDictationFrame(frame: DictationServerFrame): string {
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
 * Decode an inbound server frame.
 *
 * A frame this build does not recognise is null rather than a guess: the client
 * has four states to draw, and an unknown one must not be rendered as an empty
 * transcript.
 */
export function decodeDictationServerFrame(raw: unknown): DictationServerFrame | null {
  const value =
    typeof raw === 'string'
      ? tryParse(raw)
      : raw instanceof Uint8Array
        ? tryParse(new TextDecoder().decode(raw))
        : raw;
  if (!isRecord(value)) return null;

  if (value.type === 'ready') return { type: 'ready' };

  if (value.type === 'progress') {
    return {
      type: 'progress',
      percent: typeof value.percent === 'number' ? value.percent : null,
      ...(typeof value.file === 'string' ? { file: value.file } : {}),
      decoding: value.decoding === true,
    };
  }

  if (value.type === 'final' && typeof value.text === 'string') {
    return { type: 'final', text: value.text };
  }

  if (value.type === 'error' && typeof value.error === 'string') {
    return { type: 'error', error: value.error, retryable: value.retryable === true };
  }

  return null;
}
