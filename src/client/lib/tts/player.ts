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
 * Chunks are requested one at a time and the next request starts while the
 * current chunk plays. That is the difference between a 14-second silence before
 * a long local answer (one `omp say` call) and audio starting after the first
 * sentence.
 */

import { readKabmoSetting } from '@/shared/lib/settings/client';
import { ttsEngine } from '@/shared/lib/tts/engines';
import { normalizeTtsConfig, type TtsConfig } from '@/shared/lib/tts/settings';
import { speechChunks } from '@/shared/lib/tts/speakable';

export type TtsStatus = 'idle' | 'loading' | 'playing' | 'error';

export interface TtsSnapshot {
  status: TtsStatus;
  /** The run this player is reading (the caller's key), or null when idle. */
  activeKey: string | null;
  error: string | null;
}

const IDLE: TtsSnapshot = { status: 'idle', activeKey: null, error: null };
const MAX_CACHED_CHUNKS = 24;

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
  private abort: AbortController | null = null;
  private finishPlayback: (() => void) | null = null;
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
    const chunks = speechChunks(text, spec.maxChars);
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

  stop(): void {
    this.run += 1;
    this.abort?.abort();
    this.abort = null;
    const audio = this.audio;
    this.audio = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    const finish = this.finishPlayback;
    this.finishPlayback = null;
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
    const fetchChunk = (index: number): Promise<Blob> => this.fetchAudio(chunks[index] ?? '', config, controller.signal);
    let next: Promise<Blob> | null = fetchChunk(0);
    next.catch(() => undefined);
    try {
      for (let index = 0; index < chunks.length; index += 1) {
        if (!next) return;
        const blob = await next;
        if (run !== this.run) return;
        next = index + 1 < chunks.length ? fetchChunk(index + 1) : null;
        next?.catch(() => undefined);
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

  private playBlob(blob: Blob, run: number): Promise<void> {
    if (run !== this.run) return Promise.resolve();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this.audio = audio;
    const finished = Promise.withResolvers<void>();
    this.finishPlayback = finished.resolve;
    const done = () => {
      this.finishPlayback = null;
      URL.revokeObjectURL(url);
      if (this.audio === audio) this.audio = null;
      finished.resolve();
    };
    const failed = (message: string) => {
      this.run += 1;
      this.abort?.abort();
      this.abort = null;
      this.publish('error', this.snapshot.activeKey, message);
      done();
    };
    audio.onended = done;
    audio.onerror = () => {
      if (run === this.run) failed('The audio could not be played.');
      else done();
    };
    void audio.play().then(() => {
      if (run === this.run && this.snapshot.status === 'loading') {
        this.publish('playing', this.snapshot.activeKey, null);
      }
    }).catch((error: unknown) => {
      if (run !== this.run) return;
      const blocked = error instanceof Error && error.name === 'NotAllowedError';
      failed(
        blocked
          ? 'The browser blocked autoplay. Press the speaker button to hear this answer.'
          : 'The audio could not be played.',
      );
    });
    return finished.promise;
  }
}

export const ttsPlayer = new TtsPlayer();
