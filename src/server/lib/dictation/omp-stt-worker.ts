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

import { resolveOmpBin } from '@kabmo-labs/kabmo-omp-cli';
import { DEFAULT_STT_MODEL, isSttModelKey, type SttProgressEvent } from '@/shared/lib/dictation/models';
import { startSttWorkerProcess, type SttWorkerProcess } from '@/server/lib/dictation/worker-process';
import type { SpeechFrame } from '@/server/lib/dictation/speech-frames';

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

/**
 * What the user sees when the worker died BEFORE answering a ping.
 *
 * This is the stale-server case, and it is not hypothetical: a server built
 * before the framed transport existed spawns the 19.x worker with 18.x Bun IPC
 * and `stdin: "ignore"`, and the worker SIGKILLs itself in ~35 ms (measured on
 * omp 19.1.1). A bare `STT worker exited.` describes a crash; this describes
 * the mismatch, which is the thing the reader can act on.
 */
const WORKER_NEVER_ANSWERED =
  'The speech-to-text worker exited before answering — usually a Kabmo/omp version mismatch. Update Kabmo on the machine running the server.';

class OmpSttWorker {
  private worker: SttWorkerProcess | null = null;
  private readonly pending = new Map<string, Pending>();
  private nextId = 1;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private ready: Promise<void> | null = null;
  /** True once the CURRENT worker answered a ping — the transport works. */
  private answered = false;

  /** Spawn (or reuse) the worker and resolve once it answers a ping. */
  private async ensureWorker(): Promise<SttWorkerProcess> {
    if (this.worker) return this.worker;
    if (this.ready) {
      await this.ready;
      if (this.worker) return this.worker;
    }

    const bin = resolveOmpBin();
    if (!bin) throw new Error('omp binary not found — install omp to use speech-to-text.');

    // The handlers are bound to THIS process: a worker killed a moment ago
    // reports its exit after the replacement has spawned, and an unbound
    // handler would tear the replacement down.
    const worker = startSttWorkerProcess(bin, {
      onFrame: (frame) => this.handleFrame(frame),
      onExit: (reason, error) => this.handleExit(worker, reason, error),
    });

    this.worker = worker;
    this.answered = false;
    this.ready = this.ping(worker).catch((error) => {
      this.teardown();
      throw error;
    });

    await this.ready;
    return worker;
  }

  private ping(child: SttWorkerProcess): Promise<void> {
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
      child.send({ type: 'ping', id });
    });
  }

  private newId(): string {
    return String(this.nextId++);
  }

  private handleFrame(frame: SpeechFrame): void {
    if (frame.type === 'log') return;
    const entry = frame.id ? this.pending.get(frame.id) : undefined;

    if (frame.type === 'pong') {
      this.answered = true;
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

  /**
   * A worker reported its exit. Ignored when it is not the CURRENT one: a
   * process killed a moment ago exits while its replacement is already serving,
   * and that exit must not tear the replacement down. (Measured: without this
   * guard a recycled worker failed the next utterance every time.)
   */
  private handleExit(worker: SttWorkerProcess, reason: 'exit' | 'broken', error?: Error): void {
    if (this.worker !== worker) return;
    if (reason === 'broken') {
      this.release(error ?? new Error('The speech-to-text worker stream broke.'));
      return;
    }
    if (!this.answered && this.pending.size > 0) {
      // The one case where the log has more than the sentence: a worker that
      // died before answering usually printed why.
      const tail = worker.stderrTail().trim();
      if (tail) console.error(`[dictation] the stt worker died before answering:\n${tail}`);
    }
    this.teardown();
  }

  /** Report `error` to everything waiting, then release the process. */
  private release(error: Error): void {
    const worker = this.worker;
    this.worker = null;
    this.ready = null;
    this.answered = false;
    this.clearIdle();
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
    worker?.kill();
  }

  /**
   * Release the process and reject whatever was waiting on it.
   *
   * The message is decided by whether the current child ever answered: a
   * worker that never answered is the stale-transport case, and saying "exited"
   * to a reader whose server just cannot speak to their omp version names the
   * symptom instead of the cause.
   */
  private teardown(): void {
    const answered = this.answered;
    this.release(new Error(answered ? 'STT worker exited.' : WORKER_NEVER_ANSWERED));
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
    const worker = await this.ensureWorker();
    const id = this.newId();
    const modelKey = isSttModelKey(options.modelKey) ? options.modelKey : DEFAULT_STT_MODEL;

    this.clearIdle();

    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress: options.onProgress });
      worker.send({
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
    return this.worker !== null;
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
