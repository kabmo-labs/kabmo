/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Client for omp's OWN speech-to-text worker — the local, on-device models
 * behind `stt.enabled` in the TUI.
 *
 * Why a worker and not the agent RPC: omp's STT is a TUI feature. It captures
 * the mic of the machine running the TUI, is toggled by a keybinding
 * (`app.stt.toggle`), and is NOT reachable over `--mode rpc` (verified against
 * omp 18.4.10: `stream_start`/`stream_audio`/`transcribe`/`download` all answer
 * `Unknown command`), nor is it a tool or slash command (absent from
 * `get_available_commands`).
 *
 * **Transport: newline-free binary frames on stdin/stdout.** omp 19 moved the
 * worker behind a daemon tunnel whose payload is a length-prefixed frame
 * (`u32 length | u8 kind | body`); the codec lives in `speech-frames.ts` with
 * the layout and the measurement. The 18.x line used Bun IPC
 * (`process.send` + `serialization: "advanced"`) instead, which on 19.1.1 makes
 * the worker exit with SIGKILL ~25 ms after spawn — the process reads
 * `Bun.stdin.stream()` and kills itself when that stream ends, and Kabmo spawned
 * it with `stdin: 'ignore'`. That is why this module speaks the framing and
 * nothing else: two transports for one undocumented protocol is two ways to be
 * deaf, and the build pins 19.1.1.
 *
 * Measured on 19.1.1 (2026-11-24): ping answered in 24 ms; a 7 s Indonesian
 * utterance transcribed in ~0.9 s on a warm model; and the transcript is
 * identical to the same audio decoded in-process by transformers.js, which is
 * what proves the frame codec neither shifts nor truncates the samples.
 *
 * `audio` is a **Float32Array of normalized 16 kHz samples**. The encoder moves
 * it into the frame payload and names it with `$pcm`; sending the array inside
 * the JSON instead turns it into `{"0":…}` and the worker answers
 * `aud.subarray is not a function`.
 */

import type { Subprocess } from 'bun';
import { resolveOmpBin } from '@/server/lib/omp/core/cli';
import { DEFAULT_STT_MODEL, isSttModelKey, type SttProgressEvent } from '@/shared/lib/dictation/models';
import { SpeechFrameDecoder, encodeSpeechFrame, type SpeechFrame } from '@/server/lib/dictation/speech-frames';

type WorkerChild = Subprocess<'pipe', 'pipe', 'pipe'>;

interface Pending {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  onProgress?: (event: SttProgressEvent) => void;
}

/** Kill a worker that has been idle this long — it holds a loaded model. */
const IDLE_SHUTDOWN_MS = 10 * 60 * 1000;
const START_TIMEOUT_MS = 10_000;

/** What the user sees when no transport answered. */
const NO_ANSWER = 'The local speech-to-text worker did not answer.';

class OmpSttWorker {
  private child: WorkerChild | null = null;
  private decoder = new SpeechFrameDecoder();
  private readonly pending = new Map<string, Pending>();
  private nextId = 1;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private ready: Promise<void> | null = null;

  /** Spawn (or reuse) the worker and resolve once it answers a ping. */
  private async ensureWorker(): Promise<WorkerChild> {
    if (this.child) return this.child;
    if (this.ready) {
      await this.ready;
      if (this.child) return this.child;
    }

    const bin = resolveOmpBin();
    if (!bin) throw new Error('omp binary not found — install omp to use speech-to-text.');

    const child = Bun.spawn({
      cmd: [bin, '__omp_worker_stt'],
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: process.env,
      onExit: () => this.handleExit(),
    }) as unknown as WorkerChild;

    this.child = child;
    this.decoder = new SpeechFrameDecoder();
    void this.pump(child);
    this.ready = this.ping(child).catch((error) => {
      this.teardown();
      throw error;
    });

    await this.ready;
    return child;
  }

  /** Read frames until the pipe closes or a frame is malformed. */
  private async pump(child: WorkerChild): Promise<void> {
    const reader = child.stdout.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        for (const frame of this.decoder.push(value)) this.handleFrame(frame);
      }
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private send(child: WorkerChild, frame: Record<string, unknown>): void {
    try {
      child.stdin.write(encodeSpeechFrame(frame));
      // Buffered writes stay ordered; the flush is what puts the frame on the
      // wire before a decode that can take a second.
      void child.stdin.flush();
    } catch {
      // Closed pipe: the exit handler is what reports it.
    }
  }

  private ping(child: WorkerChild): Promise<void> {
    const id = this.newId();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${NO_ANSWER} (no ping within ${START_TIMEOUT_MS / 1000}s)`));
      }, START_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.send(child, { type: 'ping', id });
    });
  }

  private newId(): string {
    return String(this.nextId++);
  }

  private handleFrame(frame: SpeechFrame): void {
    if (frame.type === 'log') return;
    const entry = frame.id ? this.pending.get(frame.id) : undefined;

    if (frame.type === 'pong') {
      entry?.resolve('');
      return;
    }

    if (frame.type === 'progress') {
      entry?.onProgress?.(frame.event as SttProgressEvent);
      return;
    }

    if (frame.type === 'transcription') {
      if (!frame.id) return;
      this.pending.delete(frame.id);
      entry?.resolve(typeof frame.text === 'string' ? frame.text : '');
      this.scheduleIdleShutdown();
      return;
    }

    if (frame.type === 'error') {
      if (!frame.id) return;
      this.pending.delete(frame.id);
      entry?.reject(new Error(typeof frame.error === 'string' ? frame.error : 'Speech transcription failed.'));
      this.scheduleIdleShutdown();
    }
  }

  private handleExit(): void {
    this.teardown();
  }

  /** A broken stream: report its reason, then release the process. */
  private fail(error: Error): void {
    const child = this.child;
    this.child = null;
    this.ready = null;
    this.clearIdle();
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
    try {
      child?.kill();
    } catch {
      // already gone
    }
  }

  private teardown(): void {
    const child = this.child;
    this.child = null;
    this.ready = null;
    this.clearIdle();
    for (const entry of this.pending.values()) {
      entry.reject(new Error('STT worker exited.'));
    }
    this.pending.clear();
    try {
      child?.kill();
    } catch {
      // already gone
    }
  }

  private clearIdle(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  private scheduleIdleShutdown(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => this.teardown(), IDLE_SHUTDOWN_MS);
    // Never hold the process open for the worker's sake.
    this.idleTimer.unref?.();
  }

  /**
   * Transcribe one utterance. `samples` is normalized Float32 at 16 kHz.
   * `onProgress` receives model download/init events so the UI can show why a
   * first request is slow.
   */
  async transcribe(
    samples: Float32Array,
    options: { modelKey?: string; language?: string; onProgress?: (event: SttProgressEvent) => void },
  ): Promise<string> {
    const child = await this.ensureWorker();
    const id = this.newId();
    const modelKey = isSttModelKey(options.modelKey) ? options.modelKey : DEFAULT_STT_MODEL;

    this.clearIdle();

    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress: options.onProgress });
      this.send(child, {
        type: 'transcribe',
        id,
        modelKey,
        audio: samples,
        ...(options.language ? { language: options.language } : {}),
      });
    });
  }

  /** Whether a worker is currently alive (a ping answered, not yet idle-killed). */
  get alive(): boolean {
    return this.child !== null;
  }

  /**
   * Start the worker and answer whether it came up.
   *
   * This is the only honest capability test: the process either answers a ping
   * or it does not, and a version that changed its transport fails here in
   * milliseconds instead of failing a user's first utterance. A successful
   * probe schedules the idle shutdown, so a settings page visit does not pin a
   * loaded model in memory.
   */
  async probe(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.ensureWorker();
      this.scheduleIdleShutdown();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Stop the worker immediately (server teardown / engine reload). */
  shutdown(): void {
    this.teardown();
  }
}

// Anchored on globalThis for the same reason the database and terminal store
// are: `bun --hot` re-evaluates this module while the spawned worker (and the
// model it holds in memory) lives on, and a module-level binding would orphan
// the child with no handle left to kill it.
const globalStore = globalThis as typeof globalThis & { __kabmoSttWorker?: OmpSttWorker };

/** The process-wide STT worker. */
export function sttWorker(): OmpSttWorker {
  return (globalStore.__kabmoSttWorker ??= new OmpSttWorker());
}

/** Recycle the worker so the next request boots a fresh one (omp update / reload). */
export function recycleSttWorker(): void {
  globalStore.__kabmoSttWorker?.shutdown();
}
