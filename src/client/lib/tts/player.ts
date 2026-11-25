/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The browser's one speech player.
 *
 * A module singleton rather than a component because playback outlives any
 * single button: the assistant footer mounts and unmounts with the row window,
 * while a two-minute answer must keep reading. The store exposes an immutable
 * snapshot so the speaker button can follow the run it started.
 *
 * An answer is read as a stream. `speechChunks` cuts it at paragraph and
 * sentence boundaries, two requests stay in flight, and each chunk plays as
 * soon as it lands — that is the difference between a 14-second silence before
 * a long local answer and audio starting after the first paragraph. Pause
 * suspends the current element and never starts the next chunk, so a paused
 * read costs no synthesis; resume continues from the same sample.
 */

import { readKabmoSetting } from '@/shared/lib/settings/client';
import { ttsEngine } from '@/shared/lib/tts/engines';
import { normalizeTtsConfig, type TtsConfig } from '@/shared/lib/tts/settings';
import { speechChunks } from '@/shared/lib/tts/speakable';

export type TtsStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface TtsSnapshot {
  status: TtsStatus;
  /** The run this player is reading (the caller's key), or null when idle. */
  activeKey: string | null;
  error: string | null;
}

const IDLE: TtsSnapshot = { status: 'idle', activeKey: null, error: null };
const MAX_CACHED_CHUNKS = 24;
/**
 * Chunks requested ahead of the one playing. One ahead is not enough: a
 * provider's cold start (or a local `omp say` spawn) can outlast the audio of
 * the previous chunk, and the read then falls silent at a chunk boundary.
 */
const PREFETCH_WINDOW = 2;
/**
 * The most text one request carries. The engine's own `maxChars` is a ceiling,
 * not a target: a 4000-character chunk is minutes of speech and megabytes of
 * WAV, so a boundary is placed long before it. That keeps pause responsive and
 * the pipeline short.
 */
const STREAM_CHUNK_CHARS = 1000;

export function readTtsConfig(): TtsConfig {
  return normalizeTtsConfig(readKabmoSetting<unknown>('tts'));
}

function cacheKey(config: TtsConfig, text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const signature = [config.engine, config.model, config.voice, config.speed, config.language, config.baseUrl].join('|');
  return `${signature}|${text.length}|${(hash >>> 0).toString(36)}`;
}

class TtsPlayer {
  private snapshot: TtsSnapshot = IDLE;
  private readonly listeners = new Set<() => void>();
  private readonly cache = new Map<string, Blob>();
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private abort: AbortController | null = null;
  /** Ends the chunk in flight; an argument reports it as a failure. */
  private finishPlayback: ((message?: string) => void) | null = null;
  private paused = false;
  private run = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): TtsSnapshot => this.snapshot;

  private publish(status: TtsStatus, activeKey: string | null, error: string | null): void {
    this.snapshot = { status, activeKey, error };
    for (const listener of this.listeners) listener();
  }

  /** Read `text` aloud; `key` identifies the run so its button can follow. */
  speak(text: string, key: string, override?: TtsConfig): void {
    this.stop();
    const config = override ?? readTtsConfig();
    const spec = ttsEngine(config.engine);
    const chunks = speechChunks(text, Math.min(spec.maxChars, STREAM_CHUNK_CHARS));
    if (chunks.length === 0) {
      this.publish('idle', null, null);
      return;
    }

    const run = ++this.run;
    const controller = new AbortController();
    this.abort = controller;
    this.publish('loading', key, null);

    void this.playChunks(chunks, config, key, run, controller);
  }

  /** Hold the read where it is; the next chunk is not started. */
  pause(): void {
    const status = this.snapshot.status;
    if (this.paused || (status !== 'playing' && status !== 'loading')) return;
    this.paused = true;
    this.audio?.pause();
    this.publish('paused', this.snapshot.activeKey, null);
  }

  /** Continue a paused read from the sample it stopped on. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    const audio = this.audio;
    const key = this.snapshot.activeKey;
    if (!audio) {
      this.publish('loading', key, null);
      return;
    }
    this.publish('playing', key, null);
    this.startPlayback(audio, this.run);
  }

  stop(): void {
    this.run += 1;
    this.abort?.abort();
    this.abort = null;
    this.paused = false;
    const finish = this.finishPlayback;
    this.finishPlayback = null;
    const audio = this.audio;
    this.audio = null;
    const url = this.objectUrl;
    this.objectUrl = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    if (url) URL.revokeObjectURL(url);
    finish?.();
    if (this.snapshot.status !== 'idle' || this.snapshot.activeKey !== null) {
      this.publish('idle', null, null);
    }
  }

  private async playChunks(
    chunks: string[],
    config: TtsConfig,
    key: string,
    run: number,
    controller: AbortController,
  ): Promise<void> {
    const pending = new Map<number, Promise<Blob>>();
    const startFetch = (index: number): void => {
      if (index >= chunks.length || pending.has(index)) return;
      const promise = this.fetchAudio(chunks[index] ?? '', config, controller.signal);
      promise.catch(() => undefined);
      pending.set(index, promise);
    };
    for (let index = 0; index < PREFETCH_WINDOW; index += 1) startFetch(index);

    try {
      for (let index = 0; index < chunks.length; index += 1) {
        if (run !== this.run) return;
        const blob = await pending.get(index);
        pending.delete(index);
        if (!blob || run !== this.run) return;
        startFetch(index + PREFETCH_WINDOW);
        await this.playBlob(blob, run);
        if (run !== this.run) return;
      }
      if (run === this.run) this.publish('idle', null, null);
    } catch (error) {
      if (run !== this.run) return;
      const message = error instanceof Error ? error.message : 'Could not read the answer aloud.';
      this.publish('error', key, message);
    }
  }

  private async fetchAudio(text: string, config: TtsConfig, signal: AbortSignal): Promise<Blob> {
    const key = cacheKey(config, text);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const response = await fetch('/api/tts/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, config }),
      signal,
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const message = typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>).error === 'string'
        ? String((body as Record<string, unknown>).error)
        : `The speech route answered ${response.status}.`;
      throw new Error(message);
    }
    const blob = await response.blob();
    this.cache.set(key, blob);
    while (this.cache.size > MAX_CACHED_CHUNKS) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return blob;
  }

  private failRun(message: string): void {
    this.run += 1;
    this.abort?.abort();
    this.abort = null;
    this.paused = false;
    this.publish('error', this.snapshot.activeKey, message);
  }

  private startPlayback(audio: HTMLAudioElement, run: number): void {
    void audio.play().then(() => {
      if (run !== this.run || this.paused) return;
      const status = this.snapshot.status;
      if (status === 'loading' || status === 'paused') {
        this.publish('playing', this.snapshot.activeKey, null);
      }
    }).catch((error: unknown) => {
      if (run !== this.run || this.paused) return;
      if (error instanceof Error && error.name === 'AbortError') return;
      const blocked = error instanceof Error && error.name === 'NotAllowedError';
      this.finishPlayback?.(
        blocked
          ? 'The browser blocked autoplay. Press the speaker button to hear this answer.'
          : 'The audio could not be played.',
      );
    });
  }

  private playBlob(blob: Blob, run: number): Promise<void> {
    if (run !== this.run) return Promise.resolve();
    const audio = this.audio ?? new Audio();
    this.audio = audio;

    const url = URL.createObjectURL(blob);
    const stale = this.objectUrl;
    this.objectUrl = url;
    audio.src = url;
    if (stale) URL.revokeObjectURL(stale);

    const finished = Promise.withResolvers<void>();
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      if (this.finishPlayback === fail) this.finishPlayback = null;
      audio.onended = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      audio.load();
      if (this.audio === audio) this.audio = null;
      if (this.objectUrl === url) this.objectUrl = null;
      URL.revokeObjectURL(url);
      finished.resolve();
    };
    const fail = (message?: string): void => {
      if (message) this.failRun(message);
      done();
    };

    this.finishPlayback = fail;
    audio.onended = done;
    audio.onerror = () => {
      if (run === this.run) fail('The audio could not be played.');
      else done();
    };
    // A paused read never starts the next chunk; `resume` starts this one.
    if (!this.paused) this.startPlayback(audio, run);
    return finished.promise;
  }
}

export const ttsPlayer = new TtsPlayer();
