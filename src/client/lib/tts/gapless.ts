/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Gapless synthesis playback.
 *
 * The player used to start one `<audio>` element per chunk. Even when the next
 * blob was already in memory, swapping `src` tore down the decoder and called
 * `play()` again, so every paragraph boundary carried an audible pause. This
 * module decodes each chunk to an `AudioBuffer` and starts it at the previous
 * buffer's exact end, on the browser's own continuous timeline.
 *
 * Pause suspends the context instead of the element: `currentTime` freezes,
 * the scheduled sources keep their sample offsets, and resume continues from
 * the same sample. Stop closes the context; the next read opens a fresh one.
 *
 * The context is created on the first scheduled read, so the module can be
 * imported where no `AudioContext` exists (the server bundle, tests) and the
 * refusal arrives on the click that needs it.
 */

const START_LEAD_SECONDS = 0.05;
/**
 * Decoded audio kept ahead of the playhead. Three chunks is enough for the
 * next request to land while two are still queued, without holding a
 * ten-minute answer in memory.
 */
const MAX_SCHEDULED_CHUNKS = 3;
const RESUME_TIMEOUT_MS = 750;
const BLOCKED_MESSAGE = 'The browser blocked autoplay. Press the speaker button to hear this answer.';

interface AudioGlobals {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

export class GaplessAudio {
  private context: AudioContext | null = null;
  private nextStart = 0;
  private readonly active = new Set<AudioBufferSourceNode>();
  private readonly roomWaiters = new Set<() => void>();
  private readonly idleWaiters = new Set<() => void>();
  private paused = false;
  private generation = 0;

  constructor(private readonly createContext: () => AudioContext) {}

  static create(): GaplessAudio | null {
    const scope = globalThis as unknown as AudioGlobals;
    const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
    return Ctor ? new GaplessAudio(() => new Ctor()) : null;
  }

  get hasAudio(): boolean {
    return this.active.size > 0;
  }

  /** Open the context and make sure the browser will let it start. */
  async ensure(): Promise<void> {
    const existing = this.context?.state === 'closed' ? null : this.context;
    const context = existing ?? this.open();
    this.context = context;
    if (this.paused) {
      if (context.state === 'running') await context.suspend().catch(() => undefined);
      return;
    }
    await this.resumeContext(context);
    if (this.paused && context.state === 'running') await context.suspend().catch(() => undefined);
  }

  /** Decode one chunk and put it on the queue; resolves once it is scheduled. */
  async schedule(blob: Blob): Promise<void> {
    const generation = this.generation;
    const context = this.context;
    if (!context) throw new Error('Speech playback has not started.');

    const bytes = await blob.arrayBuffer();
    if (generation !== this.generation) return;

    let buffer: AudioBuffer;
    try {
      buffer = await context.decodeAudioData(bytes);
    } catch {
      throw new Error('The audio could not be decoded.');
    }
    if (generation !== this.generation) return;

    while (this.active.size >= MAX_SCHEDULED_CHUNKS && generation === this.generation) {
      const room = Promise.withResolvers<void>();
      this.roomWaiters.add(room.resolve);
      await room.promise;
    }
    if (generation !== this.generation) return;
    this.startBuffer(context, buffer);
  }

  /** Resolve when every scheduled buffer has finished playing. */
  finish(): Promise<void> {
    if (this.active.size === 0) return Promise.resolve();
    const idle = Promise.withResolvers<void>();
    this.idleWaiters.add(idle.resolve);
    return idle.promise;
  }

  pause(): void {
    this.paused = true;
    const context = this.context;
    if (context && context.state === 'running') void context.suspend().catch(() => undefined);
  }

  /** Continue a paused read at the sample where the context froze. */
  async resume(): Promise<void> {
    this.paused = false;
    const context = this.context;
    if (!context) return;
    await this.resumeContext(context);
  }

  /** Silence the context after a natural end without closing it. */
  idle(): void {
    const context = this.context;
    if (context && context.state === 'running') void context.suspend().catch(() => undefined);
  }

  stop(): void {
    this.generation += 1;
    for (const source of this.active) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // The source already ended; there is nothing left to stop.
      }
      try {
        source.disconnect();
      } catch {
        // The node was never connected, or was already disconnected.
      }
    }
    this.active.clear();
    this.nextStart = 0;
    this.paused = false;
    this.notifyRoom();
    this.notifyIdle();
    const context = this.context;
    this.context = null;
    if (context) void context.close().catch(() => undefined);
  }

  private open(): AudioContext {
    try {
      return this.createContext();
    } catch (error) {
      throw new Error(
        error instanceof Error && error.name === 'NotAllowedError'
          ? BLOCKED_MESSAGE
          : 'This browser cannot play synthesized speech.',
      );
    }
  }

  private async resumeContext(context: AudioContext): Promise<void> {
    if (context.state === 'closed') throw new Error('Speech playback was closed.');
    if (context.state === 'suspended') {
      const timeout = Promise.withResolvers<void>();
      const timer = setTimeout(() => timeout.resolve(), RESUME_TIMEOUT_MS);
      const resume = context.resume().catch(() => undefined);
      try {
        await Promise.race([resume, timeout.promise]);
      } finally {
        clearTimeout(timer);
      }
    }
    if (context.state !== 'running' && !this.paused) throw new Error(BLOCKED_MESSAGE);
  }

  private startBuffer(context: AudioContext, buffer: AudioBuffer): void {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => {
      this.active.delete(source);
      this.notifyRoom();
      this.notifyIdle();
    };
    this.active.add(source);

    const startAt = Math.max(context.currentTime + START_LEAD_SECONDS, this.nextStart);
    this.nextStart = startAt + buffer.duration;
    source.start(startAt);
  }

  private notifyRoom(): void {
    for (const resolve of this.roomWaiters) resolve();
    this.roomWaiters.clear();
  }

  private notifyIdle(): void {
    if (this.active.size > 0) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}
