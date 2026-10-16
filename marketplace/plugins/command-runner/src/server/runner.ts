/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The run's own lifecycle: spawn it, follow its pipes, publish its growth.
 *
 * The other half — the runs, the state they publish, and every sweep that ends
 * them — is `RunStore` in `./run-store`, and this class extends it. The split is
 * the 350-line ceiling, and it falls on a real seam: everything here happens to
 * ONE run and needs the process, while everything there happens to the SET.
 */

import type { Run } from './run-types';
import { appendToRing, emptyRing } from './ring';
import { RunStore } from './run-store';

/** How often a growing buffer is announced on the topic, per run. */
const OUTPUT_PUBLISH_MS = 250;

/** The registry the server half holds: one instance per plugin load. */
export class RunRegistry extends RunStore {
  /**
   * Start a run.
   *
   * The argv is built by the CALLER from a command id it re-resolved against its
   * own scan — this never takes a command line, which is what keeps the RPC
   * surface from being a remote-command-execution endpoint.
   */
  async start(input: {
    id: string;
    sessionId: string | null;
    scopeKey: string;
    commandId: string;
    file: string;
    cwd: string;
    argv: string[];
    label: string;
    background: boolean;
  }): Promise<{ runId: string } | { error: string }> {
    const maxRuns = (await this.deps.setting<number>('maxRuns')) ?? 8;
    if (this.runningCount >= maxRuns) {
      // Refused with a reason rather than queued: a silent queue reads as a
      // command that did nothing, and a runaway script starting a hundred
      // processes is what the cap exists for.
      return { error: `at_capacity: ${maxRuns} runs are already in flight` };
    }

    const run: Run = {
      id: input.id,
      sessionId: input.sessionId,
      scopeKey: input.scopeKey,
      commandId: input.commandId,
      file: input.file,
      cwd: input.cwd,
      argv: input.argv,
      label: input.label,
      background: input.background,
      proc: null,
      status: 'running',
      startedAt: Date.now(),
      endedAt: null,
      exitCode: null,
      signal: null,
      bytes: 0,
      ring: emptyRing(),
      lastPublishAt: 0,
      publishTimer: null,
    };

    let proc: Bun.Subprocess;
    try {
      proc = Bun.spawn({
        cmd: input.argv,
        cwd: input.cwd,
        stdout: 'pipe',
        stderr: 'pipe',
        // The group the kill reaches. Without it the signal stops the shell and
        // leaves whatever it started running.
        detached: true,
        env: { ...Bun.env },
      });
    } catch (error) {
      // A missing binary THROWS here (measured), so this is the only path that
      // reports it — a non-zero exit would be a different failure.
      const message = error instanceof Error ? error.message : String(error);
      run.status = 'failed';
      run.endedAt = Date.now();
      run.error = `Failed to start ${input.argv[0]}: ${message}`;
      this.deps.log(`run failed to start: ${run.error}`);
      this.runs.set(run.id, run);
      this.deps.publish(this.state());
      return { error: run.error };
    }

    run.proc = proc;
    this.runs.set(run.id, run);
    this.deps.publish(this.state());

    void this.follow(run, proc);
    return { runId: run.id };
  }

  /** Read both pipes into the ring until the process exits. */
  private async follow(run: Run, proc: Bun.Subprocess): Promise<void> {
    const read = async (stream: ReadableStream<Uint8Array> | number | undefined): Promise<void> => {
      // A stream that is not a stream is Bun's own numeric stream id, which only
      // appears when a caller asked for `'pipe'` and got something else. Nothing
      // to read, so nothing to do.
      if (!stream || typeof stream === 'number') return;
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value && value.length > 0) this.append(run, value);
      }
    };

    try {
      await Promise.all([read(proc.stdout), read(proc.stderr)]);
      await proc.exited;
    } catch (error) {
      run.error = error instanceof Error ? error.message : String(error);
    }

    // The pipes are drained and the process is gone: this is where the outcome is
    // known. `exitCode` is null for a killed child, which is why the SIGNAL is
    // recorded beside it.
    if (run.status === 'running') {
      run.status = run.signal ? 'stopped' : proc.exitCode === 0 ? 'exited' : 'failed';
    }
    run.exitCode = proc.exitCode;
    run.signal = proc.signalCode ?? null;
    run.endedAt = Date.now();
    this.flushPublish(run);
    this.deps.publish(this.state());
  }

  /** Append bytes to the ring, dropping the oldest, and announce the growth. */
  private append(run: Run, chunk: Uint8Array): void {
    run.bytes += chunk.length;
    appendToRing(run.ring, chunk);
    // The byte count has to move for an open log to re-read, so a growing buffer
    // publishes — throttled, because the payload is a COUNT and one frame per
    // chunk would be one frame per read.
    const now = Date.now();
    if (now - run.lastPublishAt >= OUTPUT_PUBLISH_MS) {
      run.lastPublishAt = now;
      this.deps.publish(this.state());
      return;
    }
    if (run.publishTimer) return;
    run.publishTimer = setTimeout(() => {
      run.publishTimer = null;
      run.lastPublishAt = Date.now();
      this.deps.publish(this.state());
    }, OUTPUT_PUBLISH_MS);
  }

  /** Cancel a pending coalesced publish, so a terminal state is not overwritten. */
  private flushPublish(run: Run): void {
    if (run.publishTimer) {
      clearTimeout(run.publishTimer);
      run.publishTimer = null;
    }
  }

}
