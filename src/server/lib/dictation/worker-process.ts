/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `omp __omp_worker_stt` process: spawn it, frame what it says, keep what it
 * complains about.
 *
 * This is the half that has to be right about *processes* — one decoder per
 * child, stderr drained, an exit that belongs to a named handle — so the client
 * above it can be about *requests*. The transport itself is `speech-frames.ts`.
 *
 * Two measured facts shaped it:
 *
 * - **A stale server kills this child.** omp 19's worker reads
 *   `Bun.stdin.stream()` and SIGKILLs itself in ~35 ms when that stream is
 *   `'ignore'`, which is how a pre-framing Kabmo build spawned it. So `stdin`
 *   must be a pipe the client writes frames into.
 * - **A full stderr pipe blocks the child.** Nobody reads stderr in a healthy
 *   run, and 64 KB of transformers.js chatter is enough to wedge a decode. The
 *   tail is kept anyway, because a worker that dies before answering usually
 *   said why.
 */

import type { Subprocess } from 'bun';
import { SpeechFrameDecoder, encodeSpeechFrame, type SpeechFrame } from '@/server/lib/dictation/speech-frames';

type WorkerChild = Subprocess<'pipe', 'pipe', 'pipe'>;

/** How much of the child's stderr to keep for the operator's log. */
const STDERR_TAIL_BYTES = 2_000;

/** What the client sees of a running worker. */
export interface SttWorkerProcess {
  /** Write one frame; a closed pipe is the exit handler's news, not an error here. */
  send(frame: Record<string, unknown>): void;
  kill(): void;
  /** The last of the child's stderr, for a failure that needs a reason. */
  stderrTail(): string;
}

export interface SttWorkerHandlers {
  /** One decoded frame from the child. */
  onFrame(frame: SpeechFrame): void;
  /** The child is gone — it exited, or its stream broke. */
  onExit(reason: 'exit' | 'broken', error?: Error): void;
}

/**
 * Start the worker and wire its three pipes.
 *
 * The handlers are bound to THIS process: a child killed a moment ago reports
 * its exit after its replacement has spawned, and a handler that did not know
 * which process it belonged to would tear the replacement down.
 */
export function startSttWorkerProcess(bin: string, handlers: SttWorkerHandlers): SttWorkerProcess {
  const child = Bun.spawn({
    cmd: [bin, '__omp_worker_stt'],
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
    onExit: () => handlers.onExit('exit'),
  }) as unknown as WorkerChild;

  let stderrTail = '';

  const pump = async () => {
    // One decoder per child: a late chunk from a previous process must not be
    // framed together with the new one's bytes.
    const decoder = new SpeechFrameDecoder();
    const reader = child.stdout.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        for (const frame of decoder.push(value)) handlers.onFrame(frame);
      }
    } catch (error) {
      handlers.onExit('broken', error instanceof Error ? error : new Error(String(error)));
    }
  };

  const drainStderr = async () => {
    const reader = child.stderr.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        stderrTail = (stderrTail + decoder.decode(value, { stream: true })).slice(-STDERR_TAIL_BYTES);
      }
    } catch {
      // A closed stream is not a failure of its own; the exit handler reports.
    }
  };

  void pump();
  void drainStderr();

  return {
    send: (frame) => {
      try {
        child.stdin.write(encodeSpeechFrame(frame));
        // Buffered writes stay ordered; the flush is what puts the frame on the
        // wire before a decode that can take a second.
        void child.stdin.flush();
      } catch {
        // Closed pipe: the exit handler is what reports it.
      }
    },
    kill: () => {
      try {
        child.kill();
      } catch {
        // already gone
      }
    },
    stderrTail: () => stderrTail,
  };
}
