/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The text-to-speech engines Settings → Voice can drive, and the presets that
 * point an OpenAI-compatible engine at a real service.
 *
 * One table, read by the settings page, the client player and the server route,
 * so "which engines exist", "which model is the default", "how long an input the
 * engine accepts" and "does this engine need a key" cannot drift between them.
 *
 * The local engine is omp's own `say` command. It is listed as `omp` rather than
 * "local" for the same reason dictation's worker is: the process that runs it is
 * the user's omp install, and a future in-Kabmo engine would be a different id.
 */

import {
  DEEPGRAM_VOICES,
  ELEVENLABS_VOICES,
  GEMINI_VOICES,
  OPENAI_VOICES,
  XAI_VOICES,
} from '@/shared/lib/tts/voices';

export type TtsEngine = 'omp' | 'openai' | 'elevenlabs' | 'deepgram' | 'xai' | 'gemini';

export interface TtsModelOption {
  id: string;
  label: string;
  /** One line: what the model trades for what. */
  hint: string;
}

export interface TtsVoiceOption {
  id: string;
  label: string;
}

export interface TtsEngineSpec {
  id: TtsEngine;
  label: string;
  /** One line: where the text goes when this engine is selected. */
  where: string;
  /** True when the engine cannot work without an API key. */
  needsKey: boolean;
  /** True when an empty key is accepted — a local OpenAI-compatible server. */
  keyOptional: boolean;
  /** True when the endpoint is a base URL the user can point elsewhere. */
  editableBaseUrl: boolean;
  /** Endpoint used when the setting is empty; '' when the URL is fixed. */
  baseUrl: string;
  /** Model asked for when the setting is empty. */
  defaultModel: string;
  /** Voice asked for when the setting is empty. '' means the engine's own. */
  defaultVoice: string;
  models: readonly TtsModelOption[];
  voices: readonly TtsVoiceOption[];
  /** True when a voice id outside `voices` is accepted (a typed id). */
  voiceEditable: boolean;
  /**
   * Largest input one request may carry. The client splits longer answers at
   * sentence boundaries; the server refuses anything above this before a
   * provider is charged for it.
   */
  maxChars: number;
  speed: { min: number; max: number };
  /**
   * How the engine takes a language:
   * - `required`: the API rejects a request without one (xAI).
   * - `parameter`: sent as the provider's own language field when set.
   * - `instructions`: folded into the model's steering prompt (OpenAI's
   *   `gpt-4o-mini-tts`); engines without prompt steering ignore it.
   * - `auto`: no parameter; the model detects the answer's language (Gemini).
   * - `none`: the engine has no language control (omp's local voices, Aura).
   */
  language: 'required' | 'parameter' | 'instructions' | 'auto' | 'none';
  /** Where the provider documents the API, shown under the fields. */
  docs: string;
}

export const TTS_ENGINES: readonly TtsEngineSpec[] = [
  {
    id: 'omp',
    label: 'This machine (omp)',
    where: 'Text never leaves this machine. omp downloads its voice on first use.',
    needsKey: false,
    keyOptional: false,
    editableBaseUrl: false,
    baseUrl: '',
    defaultModel: '',
    defaultVoice: '',
    models: [],
    voices: [],
    voiceEditable: false,
    maxChars: 4000,
    speed: { min: 0.8, max: 1.3 },
    language: 'none',
    docs: 'https://github.com/kabmo-labs/kabmo/wiki/Chat-Stream-and-Tools',
  },
  {
    id: 'openai',
    label: 'OpenAI-compatible API',
    where: 'Text is uploaded to the endpoint below.',
    needsKey: true,
    keyOptional: true,
    editableBaseUrl: true,
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini-tts',
    defaultVoice: 'marin',
    models: [
      { id: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts', hint: 'Steerable voice; OpenAI is retiring it 2027-01-06.' },
      { id: 'tts-1', label: 'tts-1', hint: 'Lowest latency; narrower voice set.' },
      { id: 'tts-1-hd', label: 'tts-1-hd', hint: 'Higher quality, slower.' },
      { id: 'canopylabs/orpheus-v1-english', label: 'Orpheus v1 (Groq)', hint: 'Groq; English.' },
      { id: 'canopylabs/orpheus-arabic-saudi', label: 'Orpheus Arabic (Groq)', hint: 'Groq; Saudi Arabic.' },
      { id: 'kokoro', label: 'Kokoro (local server)', hint: 'Kokoro-FastAPI; no key needed.' },
    ],
    voices: OPENAI_VOICES,
    voiceEditable: true,
    maxChars: 4096,
    speed: { min: 0.25, max: 4 },
    language: 'instructions',
    docs: 'https://platform.openai.com/docs/guides/text-to-speech',
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    where: 'Text is uploaded to api.elevenlabs.io.',
    needsKey: true,
    keyOptional: false,
    editableBaseUrl: false,
    baseUrl: 'https://api.elevenlabs.io',
    defaultModel: 'eleven_multilingual_v2',
    defaultVoice: '21m00Tcm4TlvDq8ikWAM',
    models: [
      { id: 'eleven_multilingual_v2', label: 'Multilingual v2', hint: 'Natural long-form; 29 languages; 10k chars.' },
      { id: 'eleven_flash_v2_5', label: 'Flash v2.5', hint: 'Fastest and cheapest; 40k chars.' },
      { id: 'eleven_v3', label: 'v3', hint: 'Expressive; 70+ languages; 5k chars.' },
      { id: 'eleven_v4', label: 'v4', hint: 'Most expressive; 90+ languages; 100k chars.' },
    ],
    voices: ELEVENLABS_VOICES,
    voiceEditable: true,
    maxChars: 5000,
    speed: { min: 0.7, max: 1.2 },
    language: 'parameter',
    docs: 'https://elevenlabs.io/docs/api-reference/text-to-speech/convert',
  },
  {
    id: 'deepgram',
    label: 'Deepgram Aura',
    where: 'Text is uploaded to api.deepgram.com.',
    needsKey: true,
    keyOptional: false,
    editableBaseUrl: false,
    baseUrl: 'https://api.deepgram.com',
    defaultModel: 'aura-2-thalia-en',
    defaultVoice: '',
    models: DEEPGRAM_VOICES,
    voices: [],
    voiceEditable: false,
    maxChars: 2000,
    speed: { min: 0.5, max: 2 },
    language: 'none',
    docs: 'https://developers.deepgram.com/reference/text-to-speech/speak-request',
  },
  {
    id: 'xai',
    label: 'xAI Grok Voice',
    where: 'Text is uploaded to api.x.ai.',
    needsKey: true,
    keyOptional: false,
    editableBaseUrl: false,
    baseUrl: 'https://api.x.ai',
    defaultModel: 'grok-tts',
    defaultVoice: 'eve',
    models: [{ id: 'grok-tts', label: 'Grok TTS', hint: 'One model; pick a voice.' }],
    voices: XAI_VOICES,
    voiceEditable: true,
    maxChars: 60_000,
    speed: { min: 0.7, max: 1.5 },
    language: 'required',
    docs: 'https://docs.x.ai/docs/guides/voice',
  },
  {
    id: 'gemini',
    label: 'Google Gemini TTS',
    where: 'Text is uploaded to generativelanguage.googleapis.com.',
    needsKey: true,
    keyOptional: false,
    editableBaseUrl: false,
    baseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-3.8-flash-tts',
    defaultVoice: 'Kore',
    models: [
      { id: 'gemini-3.8-flash-tts', label: 'Gemini 3.8 Flash TTS', hint: 'Studio-grade, expressive; 130+ languages.' },
      { id: 'gemini-3.8-flash-lite-tts', label: 'Gemini 3.8 Flash-Lite TTS', hint: 'Faster and cheaper; 100+ languages.' },
      { id: 'gemini-3.1-flash-tts-preview', label: 'Gemini 3.1 Flash TTS (preview)', hint: 'Previous generation; low latency.' },
      { id: 'gemini-2.5-flash-preview-tts', label: 'Gemini 2.5 Flash TTS (preview)', hint: 'Legacy preview model.' },
    ],
    voices: GEMINI_VOICES,
    voiceEditable: true,
    maxChars: 4000,
    // Gemini exposes no speaking-rate field; style is steered with
    // `speech_metadata` annotations instead. A fixed range keeps the control
    // hidden rather than offering a slider that does nothing.
    speed: { min: 1, max: 1 },
    language: 'auto',
    docs: 'https://ai.google.dev/gemini-api/docs/speech-generation',
  },
];

/** One-click endpoints for the OpenAI-compatible engine. */
export interface TtsPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  voice: string;
  note: string;
}

export const TTS_PRESETS: readonly TtsPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini-tts',
    voice: 'marin',
    note: 'Needs an OpenAI key. Models retire 2027-01-06.',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'canopylabs/orpheus-v1-english',
    voice: 'troy',
    note: 'Fast and cheap; OpenAI-compatible.',
  },
  {
    id: 'kokoro',
    label: 'Local server',
    baseUrl: 'http://127.0.0.1:8880/v1',
    model: 'kokoro',
    voice: 'af_heart',
    note: 'Kokoro-FastAPI; no key needed.',
  },
  {
    id: 'openedai',
    label: 'openedai-speech',
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: 'tts-1',
    voice: 'alloy',
    note: 'Local Piper voices; no key needed.',
  },
];

/** Languages the tagged engines accept (BCP-47), plus `auto`. */
export const TTS_LANGUAGES: readonly { id: string; label: string }[] = [
  { id: 'auto', label: 'Detect automatically' },
  { id: 'en', label: 'English' },
  { id: 'id', label: 'Indonesian' },
  { id: 'zh', label: 'Chinese' },
  { id: 'ja', label: 'Japanese' },
  { id: 'ko', label: 'Korean' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'es-ES', label: 'Spanish (Spain)' },
  { id: 'es-MX', label: 'Spanish (Mexico)' },
  { id: 'pt-BR', label: 'Portuguese (Brazil)' },
  { id: 'it', label: 'Italian' },
  { id: 'ru', label: 'Russian' },
  { id: 'tr', label: 'Turkish' },
  { id: 'vi', label: 'Vietnamese' },
  { id: 'hi', label: 'Hindi' },
  { id: 'bn', label: 'Bengali' },
  { id: 'ar-EG', label: 'Arabic (Egypt)' },
  { id: 'ar-SA', label: 'Arabic (Saudi)' },
  { id: 'ar-AE', label: 'Arabic (UAE)' },
];

export function isTtsEngine(value: unknown): value is TtsEngine {
  return typeof value === 'string' && TTS_ENGINES.some((engine) => engine.id === value);
}

/** The engine's spec, or the local engine's — the shipped default. */
export function ttsEngine(id: string | undefined): TtsEngineSpec {
  return TTS_ENGINES.find((engine) => engine.id === id) ?? TTS_ENGINES[0];
}

/** The model to ask for: the configured one, else the engine's default. */
export function resolveTtsModel(engine: TtsEngine, model: string | undefined): string {
  return (model ?? '').trim() || ttsEngine(engine).defaultModel;
}

/** The voice to ask for: the configured one, else the engine's default. */
export function resolveTtsVoice(engine: TtsEngine, voice: string | undefined): string {
  return (voice ?? '').trim() || ttsEngine(engine).defaultVoice;
}

/** Clamp a speed to what the engine documents. */
export function clampTtsSpeed(engine: TtsEngine, speed: number | undefined): number {
  const spec = ttsEngine(engine);
  const value = Number.isFinite(speed) ? Number(speed) : 1;
  return Math.min(spec.speed.max, Math.max(spec.speed.min, value));
}

/** Join the speech path onto a base URL, accepting a base that already has it. */
export function speechEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) return '';
  return /\/audio\/speech$/.test(base) ? base : `${base}/audio/speech`;
}
