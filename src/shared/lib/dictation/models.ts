/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The speech-to-text models omp's own worker serves, and the shapes the
 * Kabmo reports their download progress in.
 *
 * The keys are omp's (`STT_MODELS` in the CLI bundle) — passing anything else
 * to the worker answers `Unknown stt model`. Labels and size hints mirror the
 * options omp shows in its own settings, so the two surfaces describe the same
 * set of models.
 *
 * `nemotron-streaming-en-0.6b` was added in omp 18.11.0. It is the one key the
 * worker decodes through an ONLINE recognizer (`mode: "online"`), but that is
 * omp's own streaming path (`stream_start`/`stream_audio`/`stream_stop`), which
 * Kabmo does not drive — its socket sends one utterance per `transcribe`
 * call. `decodeSegment` handles the online model on the BATCH path too
 * (measured at 18.11.0: it feeds the utterance plus a terminal padding frame
 * and returns the recognizer's text), so the key is offered here without a
 * transport change; the label says what it is for so a user does not pick it
 * expecting live words in this console.
 */

export type SttModelKey =
  | 'whisper-base'
  | 'whisper-small'
  | 'whisper-large-v3-turbo'
  | 'parakeet-tdt-0.6b-v3'
  | 'nemotron-streaming-en-0.6b';

export interface SttModel {
  key: SttModelKey;
  label: string;
  sizeHint: string;
  /** Parakeet v3 covers 25 European languages only; the Whisper tiers are multilingual. */
  multilingual: boolean;
}

export const STT_MODELS: readonly SttModel[] = [
  {
    key: 'whisper-base',
    label: 'Fast (Whisper base)',
    sizeHint: '~80 MB',
    multilingual: true,
  },
  {
    key: 'whisper-small',
    label: 'Balanced (Whisper small)',
    sizeHint: '~250 MB',
    multilingual: true,
  },
  {
    key: 'whisper-large-v3-turbo',
    label: 'Turbo (Whisper large-v3)',
    sizeHint: '~500 MB',
    multilingual: true,
  },
  {
    key: 'parakeet-tdt-0.6b-v3',
    label: 'Parakeet TDT v3 (SoTA)',
    sizeHint: '~465 MB',
    multilingual: false,
  },
  {
    key: 'nemotron-streaming-en-0.6b',
    label: 'Nemotron 0.6B (English, live in omp TUI)',
    sizeHint: '~630 MB',
    multilingual: false,
  },
];

/**
 * Default model. Deliberately the smallest MULTILINGUAL tier, not omp's own
 * default (`parakeet-tdt-0.6b-v3`, 25 European languages): the common case here
 * is a chat typed in a language Parakeet does not cover, and a first run that
 * downloads 465 MB to transcribe it wrongly is the worst possible default.
 */
export const DEFAULT_STT_MODEL: SttModelKey = 'whisper-base';

export function isSttModelKey(value: unknown): value is SttModelKey {
  return typeof value === 'string' && STT_MODELS.some((model) => model.key === value);
}

/** One model's download/init progress, as omp's worker reports it. */
export interface SttProgressEvent {
  modelKey?: string;
  status?: string;
  name?: string;
  file?: string;
  /** 0..100 for the current file. */
  progress?: number;
  loaded?: number;
  total?: number;
}

/** Compact progress for the client: percent + the file being fetched. */
export interface SttProgressSummary {
  /** 0..100 across the whole download, or null while no overall figure exists. */
  percent: number | null;
  file?: string;
  /** True once the download is done and the utterance is being decoded. */
  decoding: boolean;
}

/**
 * Fold one worker progress event into what the composer shows.
 *
 * `progress_total` is the only event that covers the whole download, so it is
 * the only one allowed to set the figure — `progress` describes a single file,
 * and taking it as the total makes the number jump backwards at every file
 * boundary.
 *
 * Its value is NOT dependable enough to pin at a ceiling, though. Measured on a
 * real first-run fetch (omp 18.4.10, ~79 MB at ~68 KB/s): the figure reached
 * 100 within the first eight seconds and then climbed past it to 2654 while the
 * files were still arriving — `loaded` accumulates across retries while `total`
 * stays fixed. A clamped 100 would therefore sit on screen for the whole
 * multi-minute download and read as "finished but stuck", so anything outside
 * 0..100 is reported as INDETERMINATE and the status line keeps saying
 * "downloading".
 */
export function summarizeProgress(event: SttProgressEvent): SttProgressSummary {
  const status = event.status ?? '';
  if (status === 'progress_total' && typeof event.progress === 'number') {
    const percent = Math.round(event.progress);
    return {
      percent: percent < 0 || percent > 100 ? null : percent,
      file: event.file,
      decoding: false,
    };
  }
  if (status === 'initiate' || status === 'download' || status === 'progress') {
    return { percent: null, file: event.file, decoding: false };
  }
  // `done` / `ready`: the fetch is over, so the wait left is decoding.
  return { percent: null, decoding: true };
}
