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
 * sentence boundaries, two requests stay in flight, and each chunk is decoded
 * into `GaplessAudio` as soon as it lands. The scheduler starts a chunk at the
 * previous one's exact end, so a paragraph boundary is not an audio boundary.
 * Pause suspends the shared audio context, which freezes every scheduled
 * source at its current sample; resume continues from there.
 */

import { readKabmoSetting } from '@/shared/lib/settings/client';
import { ttsEngine } from '@/shared/lib/tts/engines';
import { normalizeTtsConfig, type TtsConfig } from '@/shared/lib/tts/settings';
import { speechChunks } from '@/shared/lib/tts/speakable';
import { GaplessAudio } from '@/client/lib/tts/gapless';

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
  private playback: GaplessAudio | null = null;
  private abort: AbortController | null = null;
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

    const playback = this.playback ??= GaplessAudio.create();
    if (!playback) {
      this.publish('error', key, 'This browser cannot play synthesized speech.');
      return;
    }

    const run = ++this.run;
    const controller = new AbortController();
    this.abort = controller;
    this.publish('loading', key, null);

    void this.playChunks(playback, chunks, config, key, run, controller);
  }

  /** Hold the read where it is; the audio context freezes every scheduled chunk. */
  pause(): void {
    const status = this.snapshot.status;
    if (this.paused || (status !== 'playing' && status !== 'loading')) return;
    this.paused = true;
    this.playback?.pause();
    this.publish('paused', this.snapshot.activeKey, null);
  }

  /** Continue a paused read from the sample where the context froze. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    const playback = this.playback;
    const key = this.snapshot.activeKey;
    if (!playback) {
      this.publish('error', key, 'This browser cannot play synthesized speech.');
      return;
    }

    const run = this.run;
    this.publish(playback.hasAudio ? 'playing' : 'loading', key, null);
    void playback.resume().catch((error: unknown) => {
      if (run !== this.run || this.paused) return;
      this.failRun(error instanceof Error ? error.message : 'The audio could not be played.');
    });
  }

  stop(): void {
    this.run += 1;
    this.abort?.abort();
    this.abort = null;
    this.paused = false;
    this.playback?.stop();
    if (this.snapshot.status !== 'idle' || this.snapshot.activeKey !== null) {
      this.publish('idle', null, null);
    }
  }

  private async playChunks(
    playback: GaplessAudio,
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

    try {
      // A blocked autoplay must not spend a provider request before it fails.
      await playback.ensure();
      if (run !== this.run) return;
      for (let index = 0; index < PREFETCH_WINDOW; index += 1) startFetch(index);

      for (let index = 0; index < chunks.length; index += 1) {
        if (run !== this.run) return;
        const blob = await pending.get(index);
        pending.delete(index);
        if (!blob || run !== this.run) return;
        startFetch(index + PREFETCH_WINDOW);
        await playback.schedule(blob);
        if (run !== this.run) return;
        if (this.snapshot.status === 'loading') this.publish('playing', key, null);
      }

      await playback.finish();
      if (run !== this.run) return;
      playback.idle();
      this.abort = null;
      this.publish('idle', null, null);
    } catch (error: unknown) {
      if (run !== this.run) return;
      controller.abort();
      if (this.abort === controller) this.abort = null;
      this.paused = false;
      playback.stop();
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
    this.playback?.stop();
    this.publish('error', this.snapshot.activeKey, message);
  }
}

export const ttsPlayer = new TtsPlayer();
