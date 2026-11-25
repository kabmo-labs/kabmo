/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The in-process local speech engine: sherpa-onnx's Node addon, one loaded model
 * per install, synthesizing straight to a WAV buffer.
 *
 * Why this and not a spawned `omp say`: omp ships one local model (Phonon 31M,
 * English, no language input at all), and the requirement here is a model the
 * user picks plus Indonesian. sherpa-onnx runs Supertonic 3 — 31 languages
 * including `id` — at RTF 0.10 on a laptop CPU, measured on this machine.
 *
 * Four behaviours are deliberate and each answers a measured failure:
 *
 * - **The addon is imported lazily.** It is a native binary for the current
 *   platform; a static import would make an unsupported platform fail at BOOT
 *   instead of at the one click that needs it. That is the documented exception
 *   to "static imports for known modules": the module genuinely does not exist
 *   everywhere.
 * - **The declared language list is enforced here, not by the runtime.** The
 *   runtime accepts any of its 32 codes whatever model is loaded: the
 *   English-only Supertonic v1 bundle synthesizes Indonesian text when asked
 *   for `lang: "id"`. A model that declares languages refuses anything outside
 *   them, with the list in the sentence.
 * - **`es-ES` becomes `es`.** Kabmo's language picker is BCP-47; these models
 *   take ISO 639-1.
 * - **A missing model is a refusal, never a fallback to another voice.** Reading
 *   an answer in the wrong voice is worse than saying nothing.
 */

import fs from 'fs/promises';
import path from 'path';
import type { OfflineTts, SherpaRuntime } from 'sherpa-onnx-node';
import type { LocalTtsArch, LocalTtsModelInfo } from '@/shared/lib/tts/local-models';
import { TtsEngineError, type TtsAudio } from '@/server/lib/tts/engines/adapter';
import { resolveLocalLanguage, resolveLocalVoice } from '@/server/lib/tts/local-request';
import { encodeWavPcm16 } from '@/server/lib/tts/wav';

interface LoadedEngine {
  engine: OfflineTts;
  sampleRate: number;
  voices: number;
}

interface SherpaState {
  /** The resolved module, once the import succeeded. */
  module: SherpaRuntime | null;
  /** A string once the import failed, so it is reported instead of retried. */
  failure: string | null;
  engines: Map<string, LoadedEngine>;
}

/**
 * The addon holds native handles and `bun --hot` re-evaluates this module while
 * the handle lives on, so the cache lives on `globalThis` — the same rule the
 * database handle follows.
 */
function state(): SherpaState {
  const key = Symbol.for('kabmo.tts.sherpa');
  const holder = globalThis as unknown as Record<symbol, SherpaState | undefined>;
  let value = holder[key];
  if (!value) {
    value = { module: null, failure: null, engines: new Map() };
    holder[key] = value;
  }
  return value;
}

/**
 * The addon, imported once.
 *
 * A dynamic import with a literal specifier, deliberately: the package's entry
 * loads a platform-specific `.node` binary, and on a platform it does not ship
 * for that throw must happen on the click that needs speech, not while the
 * server boots.
 */
async function loadSherpa(): Promise<SherpaRuntime> {
  const current = state();
  if (current.module) return current.module;
  if (current.failure) throw new TtsEngineError(current.failure, false);
  try {
    current.module = await import('sherpa-onnx-node');
    return current.module;
  } catch (error: unknown) {
    current.failure =
      `The ONNX speech runtime could not load (${error instanceof Error ? error.message : 'unknown error'}). `
      + 'Reinstall Kabmo so its native dependency matches this platform.';
    throw new TtsEngineError(current.failure, false);
  }
}

/** Whether this install can run local ONNX speech at all. */
export async function sherpaRuntime(): Promise<{ available: boolean; reason?: string }> {
  try {
    await loadSherpa();
    return { available: true };
  } catch (error: unknown) {
    return { available: false, reason: error instanceof Error ? error.message : 'The ONNX runtime is unavailable.' };
  }
}

/**
 * Every entry name in a model directory — files AND directories, because a
 * Kokoro bundle's `espeak-ng-data/` is a directory the config has to see.
 */
export async function modelEntries(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

/** First existing name from a preference list, so int8 wins over fp32. */
function pick(files: readonly string[], names: readonly string[]): string | null {
  return names.find((name) => files.includes(name)) ?? null;
}

/**
 * The runtime config for a model directory.
 *
 * Only the two architectures measured working here are offered. Piper's VITS
 * bundle is NOT one of them: sherpa-onnx ≥ 2.0 ignores `--vits-data-dir` and
 * needs phoneme codepoints from an external phonemizer, and the VITS path
 * segfaults Bun outright (measured on 1.4.5).
 */
export function buildLocalConfig(
  dir: string,
  arch: LocalTtsArch,
  files: readonly string[],
  threads = 4,
): { config: unknown; missing: string[] } {
  const at = (name: string) => path.join(dir, name);
  const missing: string[] = [];

  if (arch === 'supertonic') {
    const duration = pick(files, ['duration_predictor.int8.onnx', 'duration_predictor.onnx']);
    const encoder = pick(files, ['text_encoder.int8.onnx', 'text_encoder.onnx']);
    const estimator = pick(files, ['vector_estimator.int8.onnx', 'vector_estimator.onnx']);
    const vocoder = pick(files, ['vocoder.int8.onnx', 'vocoder.onnx']);
    const ttsJson = pick(files, ['tts.json']);
    const indexer = pick(files, ['unicode_indexer.bin']);
    const voice = pick(files, ['voice.bin']);
    const required: [string | null, string][] = [
      [duration, 'duration_predictor.onnx'],
      [encoder, 'text_encoder.onnx'],
      [estimator, 'vector_estimator.onnx'],
      [vocoder, 'vocoder.onnx'],
      [ttsJson, 'tts.json'],
      [indexer, 'unicode_indexer.bin'],
      [voice, 'voice.bin'],
    ];
    for (const [value, name] of required) if (!value) missing.push(name);
    if (missing.length > 0) return { config: null, missing };
    return {
      missing,
      config: {
        model: {
          supertonic: {
            durationPredictor: at(duration!),
            textEncoder: at(encoder!),
            vectorEstimator: at(estimator!),
            vocoder: at(vocoder!),
            ttsJson: at(ttsJson!),
            unicodeIndexer: at(indexer!),
            voiceStyle: at(voice!),
          },
        },
        numThreads: threads,
        provider: 'cpu',
        debug: 0,
      },
    };
  }

  const model = pick(files, ['model.int8.onnx', 'model.onnx']);
  const voices = pick(files, ['voices.bin']);
  const tokens = pick(files, ['tokens.txt']);
  const required: [string | null, string][] = [
    [model, 'model.onnx'],
    [voices, 'voices.bin'],
    [tokens, 'tokens.txt'],
  ];
  for (const [value, name] of required) if (!value) missing.push(name);
  if (missing.length > 0) return { config: null, missing };
  const lexicons = files.filter((name) => /^lexicon-.*\.txt$/.test(name)).map(at);
  return {
    missing,
    config: {
      model: {
        kokoro: {
          model: at(model!),
          voices: at(voices!),
          tokens: at(tokens!),
          // `dataDir` is ignored from sherpa-onnx 2.0 (measured: it warns and
          // falls back to the lexicon), so the lexicon files are the contract.
          ...(lexicons.length > 0 ? { lexicon: lexicons.join(',') } : {}),
        },
      },
      numThreads: threads,
      provider: 'cpu',
      debug: 0,
    },
  };
}

/** The loaded engine for a directory, or a refusal naming what is missing. */
async function engineFor(dir: string, arch: LocalTtsArch): Promise<LoadedEngine> {
  const current = state();
  const key = `${arch}:${dir}`;
  const cached = current.engines.get(key);
  if (cached) return cached;

  const sherpa = await loadSherpa();
  const files = await modelEntries(dir);
  const built = buildLocalConfig(dir, arch, files);
  if (!built.config) {
    throw new TtsEngineError(`This model directory is missing ${built.missing.join(', ')}.`, false);
  }

  let engine: OfflineTts;
  try {
    engine = new sherpa.OfflineTts(built.config);
  } catch (error: unknown) {
    throw new TtsEngineError(
      `The model could not be loaded (${error instanceof Error ? error.message : 'unknown error'}).`,
      false,
    );
  }
  const loaded: LoadedEngine = { engine, sampleRate: engine.sampleRate, voices: engine.numSpeakers };
  // One model resident at a time: a loaded graph holds ~150 MB and only the
  // configured model is ever spoken.
  current.engines.clear();
  current.engines.set(key, loaded);
  return loaded;
}

/** Sample rate and speaker count, read by loading the model once. */
export async function probeLocalModel(
  dir: string,
  arch: LocalTtsArch,
): Promise<{ sampleRate: number; voices: number }> {
  const loaded = await engineFor(dir, arch);
  return { sampleRate: loaded.sampleRate, voices: loaded.voices };
}

/** Drop a model's loaded engine, so a removed directory is not still resident. */
export function forgetLocalModel(dir: string): void {
  const current = state();
  for (const key of [...current.engines.keys()]) {
    if (key.endsWith(`:${dir}`)) current.engines.delete(key);
  }
}

/** One request: an installed model directory, the text, and the two choices. */
export async function synthesizeWithLocal(input: {
  model: LocalTtsModelInfo;
  dir: string;
  text: string;
  voice: string;
  language: string;
  speed: number;
}): Promise<TtsAudio> {
  const lang = resolveLocalLanguage(input.model, input.language);
  const loaded = await engineFor(input.dir, input.model.arch);
  const sid = resolveLocalVoice(loaded.voices, input.voice);

  let audio;
  try {
    audio = loaded.engine.generate({ text: input.text, sid, lang, speed: input.speed });
  } catch (error: unknown) {
    throw new TtsEngineError(
      `Local speech failed (${error instanceof Error ? error.message : 'unknown error'}).`,
      false,
    );
  }
  if (!audio || audio.samples.length === 0) {
    throw new TtsEngineError('Local speech returned no audio.', true);
  }
  return {
    bytes: encodeWavPcm16(audio.samples, audio.sampleRate || loaded.sampleRate),
    mimeType: 'audio/wav',
  };
}
