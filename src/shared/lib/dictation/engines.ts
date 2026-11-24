/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The transcription engines the composer's mic can drive, and the presets that
 * point an OpenAI-compatible engine at a real service.
 *
 * One table, read by the settings page, the client hook and the server route, so
 * "which engines exist", "which model is the default" and "does this engine
 * need a key" cannot drift between the three.
 *
 * The local engine is omp's own worker. It is listed as `omp` rather than
 * "local" because the key that arrives at the worker is omp's model registry
 * (`shared/lib/dictation/models.ts`), and because a future in-Kabmo engine would
 * be a different id, not a rename of this one.
 */

import { DEFAULT_STT_MODEL, STT_MODELS } from '@/shared/lib/dictation/models';

export type DictationEngine = 'omp' | 'openai' | 'deepgram' | 'elevenlabs';

export interface DictationModelOption {
  /** What the engine is asked for — omp's model key, or a provider's model id. */
  id: string;
  label: string;
  /** Download size for a local model, a one-line trade-off for a hosted one. */
  hint: string;
}

export interface DictationEngineSpec {
  id: DictationEngine;
  label: string;
  /** One line: where the audio goes when this engine is selected. */
  where: string;
  /** True when the engine cannot work without an API key. */
  needsKey: boolean;
  /** True when the endpoint is a base URL the user can point elsewhere. */
  editableBaseUrl: boolean;
  /** Endpoint used when the setting is empty; '' when the URL is fixed. */
  baseUrl: string;
  /** Model asked for when the setting is empty. */
  defaultModel: string;
  models: readonly DictationModelOption[];
  /**
   * `hint`: a missing language is ENGLISH (Whisper's transformer pipeline).
   * `detect`: a missing language lets the provider detect it.
   */
  language: 'hint' | 'detect';
  /** Largest upload the provider documents, in bytes; Infinity when unbounded. */
  maxBytes: number;
  /** Where the provider documents the API, shown under the fields. */
  docs: string;
}

/**
 * The message every surface shows when omp's worker cannot start.
 *
 * It names no cause on purpose: measured on 2026-11-24, the worker exited at
 * startup because the SERVER was older than the omp build (the pre-framing
 * transport kills a 19.x worker in ~35 ms), not because omp's version was
 * broken — and the old wording ("unavailable on this omp version") sent readers
 * to the wrong end of the problem. The probe's own sentence carries the cause.
 */
export const LOCAL_DICTATION_UNAVAILABLE =
  'Local speech-to-text is unavailable. Pick an external engine in Settings → Dictation.';

const LOCAL_MODELS: readonly DictationModelOption[] = STT_MODELS.map((model) => ({
  id: model.key,
  label: model.label,
  hint: model.sizeHint,
}));

export const DICTATION_ENGINES: readonly DictationEngineSpec[] = [
  {
    id: 'omp',
    label: 'This machine (omp)',
    where: 'Audio never leaves this machine. omp downloads the model on first use.',
    needsKey: false,
    editableBaseUrl: false,
    baseUrl: '',
    defaultModel: DEFAULT_STT_MODEL,
    models: LOCAL_MODELS,
    language: 'hint',
    maxBytes: Infinity,
    docs: 'https://github.com/kabmo-labs/kabmo/wiki/Chat-Stream-and-Tools',
  },
  {
    id: 'openai',
    label: 'OpenAI-compatible API',
    where: 'Audio is uploaded to the endpoint below.',
    needsKey: true,
    editableBaseUrl: true,
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini-transcribe',
    models: [
      { id: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe', hint: 'Fast and cheap; multilingual.' },
      { id: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe', hint: 'More accurate, slower, dearer.' },
      { id: 'gpt-transcribe', label: 'gpt-transcribe', hint: 'OpenAI’s newest; also reports detected languages.' },
      { id: 'whisper-1', label: 'whisper-1', hint: 'Widest compatibility; deprecated 2027-02-26.' },
      { id: 'whisper-large-v3-turbo', label: 'whisper-large-v3-turbo', hint: 'Groq / local servers.' },
      { id: 'whisper-large-v3', label: 'whisper-large-v3', hint: 'Groq / local servers; slower, best accuracy.' },
    ],
    language: 'detect',
    maxBytes: 25 * 1024 * 1024,
    docs: 'https://platform.openai.com/docs/guides/speech-to-text',
  },
  {
    id: 'deepgram',
    label: 'Deepgram',
    where: 'Audio is uploaded to api.deepgram.com.',
    needsKey: true,
    editableBaseUrl: false,
    baseUrl: '',
    defaultModel: 'nova-3',
    models: [
      { id: 'nova-3', label: 'nova-3', hint: 'Best accuracy; multilingual mode available.' },
      { id: 'nova-2', label: 'nova-2', hint: 'Previous generation.' },
    ],
    language: 'detect',
    maxBytes: 2 * 1024 * 1024 * 1024,
    docs: 'https://developers.deepgram.com/docs/models-languages-overview',
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    where: 'Audio is uploaded to api.elevenlabs.io.',
    needsKey: true,
    editableBaseUrl: false,
    baseUrl: '',
    defaultModel: 'scribe_v2',
    models: [
      { id: 'scribe_v2', label: 'scribe_v2', hint: 'Accurate, 90+ languages.' },
      { id: 'scribe_v3', label: 'scribe_v3', hint: 'Newest; multilingual mode available.' },
    ],
    language: 'detect',
    maxBytes: 5 * 1024 * 1024 * 1024,
    docs: 'https://elevenlabs.io/docs/capabilities/speech-to-text',
  },
];

/** One-click endpoints for the OpenAI-compatible engine. */
export interface DictationPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  note: string;
}

export const DICTATION_PRESETS: readonly DictationPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini-transcribe',
    note: 'Needs an OpenAI key.',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3-turbo',
    note: 'Fast and cheap; OpenAI-compatible.',
  },
  {
    id: 'local',
    label: 'Local server',
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: 'whisper-large-v3-turbo',
    note: 'whisper.cpp server or speaches; no key needed.',
  },
];

export function isDictationEngine(value: unknown): value is DictationEngine {
  return typeof value === 'string' && DICTATION_ENGINES.some((engine) => engine.id === value);
}

/** The engine's spec, or the local engine's — the shipped default. */
export function dictationEngine(id: string | undefined): DictationEngineSpec {
  return DICTATION_ENGINES.find((engine) => engine.id === id) ?? DICTATION_ENGINES[0];
}

/** The model to ask for: the configured one, else the engine's default. */
export function resolveDictationModel(engine: DictationEngine, model: string | undefined): string {
  const spec = dictationEngine(engine);
  const trimmed = (model ?? '').trim();
  return trimmed || spec.defaultModel;
}
