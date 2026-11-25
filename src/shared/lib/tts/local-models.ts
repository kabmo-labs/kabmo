/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The local ONNX speech engine's model catalog, and the two facts a model has to
 * state before the settings page can offer it: which languages it speaks and
 * which voices it has.
 *
 * Why the catalog is Kabmo's and not the engine's: sherpa-onnx validates the
 * language code against its own 32-code list, NOT against the model that was
 * loaded. Measured — the English-only Supertonic v1 bundle happily accepts
 * `lang: "id"` and returns audio in English. A picker that trusted the runtime
 * would offer Indonesian on a model that cannot speak it, so the declared list
 * lives here, and the adapter refuses a language outside it.
 *
 * `languages: []` means the model declared nothing (a bundle added from a link
 * that carries no metadata). Those pass the language through unchanged, and the
 * settings page says so rather than pretending to know.
 */

/** Architectures the in-process runtime can load today, and only measured ones. */
export type LocalTtsArch = 'supertonic' | 'kokoro';

export interface LocalTtsModelInfo {
  /** Directory name under `<data>/tts-models`, and the value stored in settings. */
  id: string;
  label: string;
  arch: LocalTtsArch;
  /** ISO 639-1 codes the model claims. Empty = it claims nothing. */
  languages: string[];
  /** Language used when the setting is empty. */
  defaultLanguage: string;
  /** Speaker count the runtime reports; 0 until probed. */
  voices: number;
  /** Human names by speaker id, when the model documents them. */
  voiceLabels?: string[];
  sampleRate: number;
  /** Bytes on disk, for the settings copy. */
  sizeBytes?: number;
  /** Where it came from: a catalog URL or a link the user pasted. */
  sourceUrl?: string;
  installedAt?: string;
  /** True for entries the settings page offers as a one-click download. */
  curated?: boolean;
  /** One line: what this model trades for what. */
  notes?: string;
}

export type InstallStatus = 'downloading' | 'extracting' | 'probing' | 'ready' | 'error';

/** One install in flight, or the record of the last one. */
export interface InstallJob {
  id: string;
  label: string;
  status: InstallStatus;
  /** Bytes written so far. */
  received: number;
  /** `content-length`, or 0 when the server did not state one. */
  total: number;
  /** 0–1 while downloading, 1 after. */
  progress: number;
  error?: string;
  /** The URL the job is fetching — a pasted link is retried with it, not its id. */
  url?: string;
  startedAt: number;
}

/** The shipped Supertonic style tensors, in the runtime's alphabetical order. */
export const SUPERTONIC_VOICE_LABELS: readonly string[] = [
  'Female 1',
  'Female 2',
  'Female 3',
  'Female 4',
  'Female 5',
  'Male 1',
  'Male 2',
  'Male 3',
  'Male 4',
  'Male 5',
];

/** The 31 codes Supertonic 3 ships, with the label the picker shows. */
export const LOCAL_LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  ar: 'Arabic',
  bg: 'Bulgarian',
  cs: 'Czech',
  da: 'Danish',
  de: 'German',
  el: 'Greek',
  en: 'English',
  es: 'Spanish',
  et: 'Estonian',
  fi: 'Finnish',
  fr: 'French',
  hi: 'Hindi',
  hr: 'Croatian',
  hu: 'Hungarian',
  id: 'Indonesian',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  lt: 'Lithuanian',
  lv: 'Latvian',
  nl: 'Dutch',
  pl: 'Polish',
  pt: 'Portuguese',
  ro: 'Romanian',
  ru: 'Russian',
  sk: 'Slovak',
  sl: 'Slovenian',
  sv: 'Swedish',
  tr: 'Turkish',
  uk: 'Ukrainian',
  vi: 'Vietnamese',
};

const SUPERTONIC_LANGUAGES: readonly string[] = Object.keys(LOCAL_LANGUAGE_LABELS);

/**
 * Models the settings page can download with one click.
 *
 * Both are sherpa-onnx int8 bundles, which is what the runtime reads. The
 * Indonesian voice of Piper is deliberately absent: its model card names the
 * Lessac corpus, whose licence excludes commercial use of the synthesis.
 */
export const LOCAL_TTS_CATALOG: readonly LocalTtsModelInfo[] = [
  {
    id: 'supertonic-3',
    label: 'Supertonic 3',
    arch: 'supertonic',
    languages: [...SUPERTONIC_LANGUAGES],
    defaultLanguage: 'en',
    voices: 10,
    voiceLabels: [...SUPERTONIC_VOICE_LABELS],
    sampleRate: 44_100,
    sizeBytes: 146_000_000,
    curated: true,
    sourceUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2',
    notes: '99M parameters, 31 languages including Indonesian, ten voices. Weights OpenRAIL-M, runtime MIT.',
  },
  {
    id: 'kokoro-en-zh',
    label: 'Kokoro 82M (English + Chinese)',
    arch: 'kokoro',
    languages: ['en', 'zh'],
    defaultLanguage: 'en',
    voices: 103,
    sampleRate: 24_000,
    sizeBytes: 140_000_000,
    curated: true,
    sourceUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2',
    notes: '82M parameters, 103 voices, English and Chinese only — Supertonic 3 is the Indonesian one.',
  },
];

/** One catalog entry, or undefined. */
export function catalogModel(id: string): LocalTtsModelInfo | undefined {
  return LOCAL_TTS_CATALOG.find((model) => model.id === id);
}

/** The language list a model declares, or every known code when it declares none. */
export function localLanguageOptions(model: LocalTtsModelInfo | null): { id: string; label: string }[] {
  const codes = model && model.languages.length > 0 ? model.languages : Object.keys(LOCAL_LANGUAGE_LABELS);
  return codes.map((code) => ({ id: code, label: LOCAL_LANGUAGE_LABELS[code] ?? code.toUpperCase() }));
}

/** "Female 3" when the model names its voices, else "Voice 3". */
export function localVoiceLabel(model: LocalTtsModelInfo | null, sid: number): string {
  const named = model?.voiceLabels?.[sid];
  return named ?? `Voice ${sid}`;
}

/** Every voice of a model as picker options; one entry when the count is unknown. */
export function localVoiceOptions(model: LocalTtsModelInfo | null): { id: string; label: string }[] {
  const count = model?.voices ?? 0;
  if (count <= 0) return [{ id: '0', label: 'Default voice' }];
  return Array.from({ length: count }, (_unused, sid) => ({ id: String(sid), label: localVoiceLabel(model, sid) }));
}

/** Bytes → "146 MB", for a settings row that must not show a raw number. */
export function formatModelSize(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / 1_000_000;
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/** "31 languages · 10 voices · 146 MB" — the one line under a model's name. */
export function describeLocalModel(model: LocalTtsModelInfo): string {
  const parts: string[] = [];
  if (model.languages.length > 0) parts.push(`${model.languages.length} languages`);
  else parts.push('languages not declared');
  if (model.voices > 0) parts.push(`${model.voices} voices`);
  const size = formatModelSize(model.sizeBytes);
  if (size) parts.push(size);
  return parts.join(' · ');
}
