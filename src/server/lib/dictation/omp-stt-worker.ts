/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
 * What it DOES expose is an internal worker, `omp __omp_worker_stt`, whose
 * transport is **Bun IPC** (`stdin`/`stdout` are `ignore`; frames arrive on the
 * `ipc` channel with `serialization: "advanced"`). The Kabmo runs on Bun, so
 * it can spawn that same worker and speak the same frames — which is what
 * `omp-stt-worker.ts` does. The result is omp's own models with no API key and
 * no second implementation of the inference stack.
 *
 * Protocol (JSON objects, request/response by `id`):
 *   → { type: 'ping', id }
 *   → { type: 'transcribe', id, modelKey, audio, language }
 *   ← { type: 'pong', id }
 *   ← { type: 'progress', id, event }        (model download / init)
 *   ← { type: 'transcription', id, text }
 *   ← { type: 'error', id, error }
 *
 * `audio` is a **Float32Array of normalized samples at 16 kHz**, and it travels
 * as structured clone over the IPC channel — not as base64, and not as an
 * encoded file. Verified against omp 18.4.10 on real speech: a Float32Array
 * transcribes, while a base64 WAV string fails with "Unable to load audio from
 * path/URL since `AudioContext` is not available in your environment" and a
 * Uint8Array fails with "WhisperFeatureExtractor expects input to be a
 * Float32Array ... but got Uint8Array instead".
 */

import type { Subprocess } from 'bun';
import { resolveOmpBin } from '@/server/lib/omp/core/cli';
import { DEFAULT_STT_MODEL, isSttModelKey, type SttProgressEvent } from '@/shared/lib/dictation/models';

/** Same shape omp's worker uses; `ipc` only fires for object messages. */
interface WorkerChild extends Subprocess<'ignore', 'ignore', 'ignore'> {
  send(message: unknown): void;
}

interface Pending {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  onProgress?: (event: SttProgressEvent) => void;
}

/** Kill a worker that has been idle this long — it holds a loaded model. */
const IDLE_SHUTDOWN_MS = 10 * 60 * 1000;
const START_TIMEOUT_MS = 10_000;

class OmpSttWorker {
  private child: WorkerChild | null = null;
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
      // Bun IPC replaces stdio: the two streams are deliberately ignored, and
      // `serialization: "advanced"` is what makes the channel carry objects
      // rather than strings.
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
      serialization: 'advanced',
      env: process.env,
      ipc: (message: unknown) => this.handleMessage(message),
      onExit: () => this.handleExit(),
    }) as unknown as WorkerChild;

    this.child = child;
    this.ready = this.ping(child).catch((error) => {
      this.teardown();
      throw error;
    });

    await this.ready;
    return child;
  }

  private ping(child: WorkerChild): Promise<void> {
    const id = this.newId();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('STT worker did not respond to ping.'));
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
      child.send({ type: 'ping', id });
    });
  }

  private newId(): string {
    return String(this.nextId++);
  }

  private handleMessage(message: unknown): void {
    if (!message || typeof message !== 'object') return;
    const frame = message as { type?: string; id?: string; text?: string; error?: string; event?: unknown };

    if (frame.type === 'pong') {
      this.pending.get(frame.id ?? '')?.resolve('');
      return;
    }

    const entry = frame.id ? this.pending.get(frame.id) : undefined;

    if (frame.type === 'progress') {
      entry?.onProgress?.(frame.event as SttProgressEvent);
      return;
    }

    if (frame.type === 'transcription') {
      if (!frame.id) return;
      this.pending.delete(frame.id);
      entry?.resolve(frame.text ?? '');
      this.scheduleIdleShutdown();
      return;
    }

    if (frame.type === 'error') {
      if (!frame.id) return;
      this.pending.delete(frame.id);
      entry?.reject(new Error(frame.error ?? 'Speech transcription failed.'));
      this.scheduleIdleShutdown();
    }
  }

  private handleExit(): void {
    this.teardown();
  }

  private teardown(): void {
    const child = this.child;
    this.child = null;
    this.ready = null;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
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

  private scheduleIdleShutdown(): void {
    clearTimeout(this.idleTimer);
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

    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;

    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress: options.onProgress });
      child.send({
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
  globalStore.__kabmoSttWorker ??= new OmpSttWorker();
  return globalStore.__kabmoSttWorker;
}

/** Recycle the worker so the next request boots a fresh one (omp update / reload). */
export function recycleSttWorker(): void {
  globalStore.__kabmoSttWorker?.shutdown();
}
