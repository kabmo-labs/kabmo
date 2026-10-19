/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Process + protocol layer for `omp --mode rpc-ui` (NDJSON over stdio).
 * Protocol v1: commands `{id, type, ...}` on stdin; `{type:"response", id, ...}`
 * plus interleaved event frames on stdout. omp announces readiness with a
 * `{type:"ready"}` frame before accepting commands. When readiness advertises
 * protocol v2, callers negotiate it before sending normal commands; oversized
 * logical frames are then carried as bounded `rpc_chunk` sequences.
 *
 * Faithful port of omp-web/lib/omp/rpc-process.ts.
 */

import type { Subprocess } from 'bun';
import { stripKabmoHostEnv } from '@kabmo-labs/kabmo-sdk';
import { describeSpawnFailure } from '@/server/lib/lifecycle/fd-pressure';
import { resolveOmpBin } from '@/server/lib/omp/core/cli';
import { RpcFrameDecoder, encodeRpcFrames, type RpcFrameRecord, type RpcProtocolVersion } from '@/shared/lib/omp/rpc/frame';
import { killProcessTree } from '@/server/lib/lifecycle/kill-tree';
import { readLines } from '@/server/lib/omp/rpc/lines';
import { RpcCommandError, RpcCommandTimeoutError, STDERR_TAIL_LIMIT, type PendingCommand, type RpcFrame, type RpcProcessOptions, type RpcResponseFrame } from '@/server/lib/omp/rpc/process-helpers';

export { RpcCommandError, RpcCommandTimeoutError } from '@/server/lib/omp/rpc/process-helpers';
export type { RpcFrame, RpcProcessOptions, RpcResponseFrame } from '@/server/lib/omp/rpc/process-helpers';

export class RpcProcess {
  readonly cwd: string;
  private child!: Subprocess<"pipe", "pipe", "pipe">;
  private readonly pending = new Map<string, PendingCommand>();
  private readonly frameListeners = new Set<(frame: RpcFrame) => void>();
  private readyPromise: Promise<RpcFrame>;
  private nextId = 1;
  private stderrTail = '';
  private exited = false;
  private exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  private protocolVersion: RpcProtocolVersion = 1;
  private nextChunkId = 1;
  // Serializes physical stdin writes: a v2 logical frame can span multiple
  // `rpc_chunk` records (>1 MiB payloads), and two frames written concurrently
  // would interleave their chunk sequences on stdin, which RpcFrameDecoder
  // rejects. Each logical frame is enqueued whole.
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: RpcProcessOptions) {
    const resolveBin = options.dependencies?.resolveOmpBin ?? resolveOmpBin;
    const bin = resolveBin();
    if (!bin) {
      throw new Error('omp binary not found. Install oh-my-pi or set KABMO_OMP_BIN.');
    }
    this.cwd = options.cwd;
    if (options.onFrame) this.frameListeners.add(options.onFrame);

    const args = ['--mode', 'rpc-ui', '--cwd', options.cwd, ...(options.extraArgs ?? [])];
    // Strip named profiles (OMP_PROFILE/PI_PROFILE) so the child resolves the
    // same default agent dir. An explicit options.env entry still wins.
    const childEnv = stripKabmoHostEnv({ ...Bun.env, ...options.env }, process.platform);
    if (options.env?.OMP_PROFILE === undefined) delete childEnv.OMP_PROFILE;
    if (options.env?.PI_PROFILE === undefined) delete childEnv.PI_PROFILE;
    // A spawn fails synchronously when the process is out of descriptors, and
    // Bun's own `EBADF` names the binary rather than the cause; `status` and
    // the terminal panel are the diagnostics, so the message has to be right.
    try {
      this.child = Bun.spawn({
        cmd: [bin, ...args],
        cwd: options.cwd,
        env: childEnv,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        windowsHide: true,
        // On POSIX, omp launches grandchildren (LSP servers, extension subprocesses). Run the
        // child in its own process group so dispose() can SIGTERM/SIGKILL the whole
        // tree — otherwise a crashed omp would orphan its LSP children as zombies.
        // Windows uses taskkill /t instead, so detaching would only create a console.
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      throw new Error(describeSpawnFailure(error));
    }

    let resolveReady: (frame: RpcFrame) => void;
    let rejectReady: (error: Error) => void;
    this.readyPromise = new Promise<RpcFrame>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    // waitReady() is optional for callers; avoid unhandled-rejection noise when
    // the process dies before anyone awaited readiness.
    this.readyPromise.catch(() => {});

    const decoder = new RpcFrameDecoder();
    void readLines(this.child.stdout, (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // omp guards stdout in RPC mode, but never let a stray line kill the reader.
        return;
      }
      let frame: RpcFrameRecord;
      try {
        if (parsed && typeof parsed === 'object' && (parsed as { type?: unknown }).type === 'rpc_chunk' && this.protocolVersion !== 2) {
          throw new Error('RPC chunk received before protocol negotiation');
        }
        const decoded = decoder.push(parsed);
        if (!decoded) return;
        frame = decoded;
      } catch (error) {
        this.stderrTail = (this.stderrTail + `\nRPC protocol error: ${error instanceof Error ? error.message : String(error)}`).slice(-STDERR_TAIL_LIMIT);
        void this.dispose(0);
        return;
      }
      if (frame.type === 'ready') {
        resolveReady(frame);
        return;
      }
      if (frame.type === 'response') {
        this.handleResponse(frame as unknown as RpcResponseFrame);
        return;
      }
      for (const listener of this.frameListeners) {
        try {
          listener(frame);
        } catch {
          // Listener bugs must not break the protocol reader.
        }
      }
    });

    void (async () => {
      await readLines(this.child.stderr, (line) => {
        this.stderrTail = (this.stderrTail + line + '\n').slice(-STDERR_TAIL_LIMIT);
      });
    })();

    const finalize = (code: number | null, signal: NodeJS.Signals | null) => {
      if (this.exited) return;
      this.exited = true;
      this.exitInfo = { code, signal };
      const exitError = new Error(
        `omp exited (code ${code ?? 'null'}, signal ${signal ?? 'none'})${this.stderrTail ? `: ${this.stderrTail.slice(-500)}` : ''}`,
      );
      rejectReady(exitError);
      for (const [, entry] of this.pending) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.reject(exitError);
      }
      this.pending.clear();
      options.onExit?.({ code, signal, stderrTail: this.stderrTail });
    };
    void this.child.exited.then((code) => {
      finalize(code, this.child.signalCode);
    });
  }

  get isAlive(): boolean {
    return !this.exited;
  }

  /** OS pid of the spawned omp process (undefined before spawn settles). Used
   * by the browser viewer to map this process to its owned browser targets. */
  get exitDetails(): { code: number | null; signal: NodeJS.Signals | null; stderrTail: string } | null {
    return this.exitInfo ? { ...this.exitInfo, stderrTail: this.stderrTail } : null;
  }

  /** OS pid of the spawned omp process, undefined once it is gone. Used by the
   * browser viewer to map this process to its owned browser targets. */
  get pid(): number | undefined {
    return this.child.pid ?? undefined;
  }

  /** Resolves with the `ready` frame; rejects if the process dies first or the
   * timeout elapses. omp startup can take a few seconds (extensions, LSP). */
  waitReady(timeoutMs = 60_000): Promise<RpcFrame> {
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`omp RPC ready timeout after ${timeoutMs}ms`)), timeoutMs);
      timer.unref?.();
      this.readyPromise.finally(() => clearTimeout(timer)).catch(() => {});
    });
    return Promise.race([this.readyPromise, timeout]);
  }

  /** Enables bounded protocol-v2 framing when the ready frame advertises it. */
  async negotiateProtocol(ready: RpcFrame): Promise<RpcProtocolVersion> {
    const supported = Array.isArray(ready.supportedProtocolVersions) ? ready.supportedProtocolVersions : [];
    if (!supported.includes(2)) return this.protocolVersion;
    const response = await this.sendCommand<{ protocolVersion?: unknown }>({ type: 'negotiate_protocol', protocolVersion: 2 });
    if (response?.protocolVersion !== 2) throw new Error('OMP rejected RPC protocol v2 negotiation');
    this.protocolVersion = 2;
    return this.protocolVersion;
  }

  onFrame(listener: (frame: RpcFrame) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  /** Send a command and await its response `data`. A failed response rejects
   * with RpcCommandError. No timeout by default — some commands (login,
   * long prompts via bash) legitimately take minutes, and the session wrapper
   * reclaims wedged children via idle-kill and dispose(). Callers that want a
   * cap pass `timeoutMs` (>0); when set, the timer is unref'd so it never
   * keeps the event loop alive on its own. */
  sendCommand<T = unknown>(command: { type: string; [key: string]: unknown }, timeoutMs?: number): Promise<T> {
    if (this.exited) {
      return Promise.reject(new Error('omp RPC process has exited'));
    }
    const id = `w${this.nextId++}`;
    return new Promise<T>((resolve, reject) => {
      const entry: PendingCommand = {
        command: command.type,
        resolve: resolve as (data: unknown) => void,
        reject,
      };
      if (timeoutMs && timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          // Only reject if this exact entry is still pending — a reused id or a
          // response that landed between the timer firing and this callback must
          // not spuriously reject a different command.
          if (this.pending.get(id) === entry) {
            this.pending.delete(id);
            reject(new RpcCommandTimeoutError(command.type, timeoutMs));
          }
        }, timeoutMs);
        // A pending command timer must never keep the event loop alive on its own
        // (it would block graceful shutdown when omp has stopped answering).
        entry.timer.unref?.();
      }
      this.pending.set(id, entry);
      this.writeFrame({ ...command, id }, (error) => {
        if (error) {
          const pending = this.pending.get(id);
          if (pending) {
            this.pending.delete(id);
            if (pending.timer) clearTimeout(pending.timer);
            reject(error);
          }
        }
      });
    });
  }

  /** Fire-and-forget frame write (extension_ui_response, host_tool_result). */
  sendFrame(frame: { type: string; [key: string]: unknown }): void {
    if (this.exited) return;
    this.writeFrame(frame, () => {});
  }

  private writeFrame(frame: RpcFrame, callback: (error?: Error | null) => void): void {
    let lines: string[];
    try {
      lines = encodeRpcFrames(frame, this.protocolVersion, `web-${this.nextChunkId++}`);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    // Enqueue the entire encoded logical frame; the next frame's physical
    // records only start after this frame has been fully handed to the stdin
    // sink, so two frames can never interleave their chunk sequences.
    this.writeQueue = this.writeQueue.then(
      () => new Promise<void>((resolve) => {
        if (this.exited || !this.child.stdin) {
          callback(new Error('RPC process is not running'));
          resolve();
          return;
        }
        try {
          for (const line of lines) this.child.stdin.write(line);
          callback(null);
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        } finally {
          resolve();
        }
      }),
    );
  }

  private handleResponse(response: RpcResponseFrame): void {
    const id = response.id;
    const entry = id ? this.pending.get(id) : undefined;
    if (!entry || !id) {
      // Unsolicited response (or a command we already timed out) — surface to
      // frame listeners so nothing is silently dropped.
      for (const listener of this.frameListeners) {
        try {
          listener(response as unknown as RpcFrame);
        } catch {}
      }
      return;
    }
    this.pending.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    if (response.success) {
      entry.resolve(response.data);
    } else {
      entry.reject(new RpcCommandError(response.command, response.error ?? 'RPC command failed', response.code));
    }
  }

  /** Graceful shutdown: close stdin (omp exits on EOF), escalate to SIGTERM
   * then SIGKILL on the whole process group. Resolves once the process has
   * exited. Safe to call during server teardown — escalation timers are
   * unref'd so they never keep the event loop alive on their own. */
  async dispose(gracePeriodMs = 5_000): Promise<void> {
    if (this.exited) return;
    const exited = this.child.exited.then(() => undefined);
    try {
      this.child.stdin.end();
    } catch {}
    const timer = setTimeout(() => {
      if (!this.exited) killProcessTree(this.child.pid, false, 'SIGTERM');
    }, gracePeriodMs);
    const killTimer = setTimeout(() => {
      if (!this.exited) killProcessTree(this.child.pid, true, 'SIGKILL');
    }, gracePeriodMs * 2);
    timer.unref?.();
    killTimer.unref?.();
    await exited;
    clearTimeout(timer);
    clearTimeout(killTimer);
  }
}
