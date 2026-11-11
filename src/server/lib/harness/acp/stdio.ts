/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The agent child and its pipes: spawn, read lines, keep the stderr tail, and
 * dispose the process group.
 *
 * Split from `client.ts` for the repo's per-file ceiling, and the seam is real:
 * the transport OWNS a process, and this module owns what the OS sees — the
 * spawn, the two readers, the exit notice and the kill escalation. `client.ts`
 * keeps framing, the pending-call table and the verbs.
 *
 * The stderr tail exists because `exited (code 1)` tells a reader nothing: a
 * shadowed or corrupt binary usually explains itself on stderr, and that text is
 * the only actionable part of a failed spawn.
 */

import type { Subprocess } from 'bun';
import { readLines } from '@/server/lib/omp/rpc/lines';
import { killProcessTree } from '@/server/lib/lifecycle/kill-tree';
import { stripKabmoHostEnv, withToolchainPath } from '@kabmo-labs/kabmo-sdk';

const STDERR_TAIL_LIMIT = 8_000;

export interface AgentStdioOptions {
  command: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface AgentStdioHandlers {
  /** One stdout line, already trimmed of its newline — JSON or a log line. */
  onLine: (line: string) => void;
  onStderr?: (line: string) => void;
  /** The child is gone. Fires once, after `exited`. */
  onExit: (info: { code: number | null; stderrTail: string }) => void;
}

export class AgentStdio {
  readonly child: Subprocess<'pipe', 'pipe', 'pipe'>;
  #tail = '';

  constructor(options: AgentStdioOptions, handlers: AgentStdioHandlers) {
    const [command, ...args] = options.command;
    if (!command) throw new Error('ACP launch command is empty');
    const childEnv = withToolchainPath(
      stripKabmoHostEnv({ ...Bun.env, ...options.env }, process.platform),
      process.platform,
    );
    try {
      this.child = Bun.spawn({
        cmd: [command, ...args],
        cwd: options.cwd,
        env: childEnv,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        windowsHide: true,
        // Its own process group, exactly like the omp child: an ACP adapter
        // spawns ITS own agent binary (codex-acp runs codex, pi-acp runs pi),
        // so killing only the adapter leaves the real agent running.
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      throw new Error(
        `Could not start ${command}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    void readLines(this.child.stdout, (line) => handlers.onLine(line));
    void readLines(this.child.stderr, (line) => {
      this.#tail = `${this.#tail}${line}\n`.slice(-STDERR_TAIL_LIMIT);
      handlers.onStderr?.(line);
    });
    void this.child.exited.then((code) => {
      handlers.onExit({ code, stderrTail: this.#tail });
    });
  }

  get stderrTail(): string {
    return this.#tail;
  }

  get pid(): number | undefined {
    return this.child.pid ?? undefined;
  }

  /** Write one already-serialized frame. A closed pipe is not an error here:
   *  the `exited` notice is what reports it, and throwing would wedge the
   *  caller's queue. */
  write(line: string): void {
    try {
      this.child.stdin.write(line);
    } catch {
      // Closed pipe: reported by `exited`.
    }
  }

  async flush(): Promise<void> {
    try {
      await this.child.stdin.flush();
    } catch {
      // Closed pipe: reported by `exited`.
    }
  }

  /** Graceful then forceful shutdown of the whole process group. */
  async dispose(gracePeriodMs = 5_000): Promise<void> {
    const exited = this.child.exited.then(() => undefined);
    try {
      this.child.stdin.end();
    } catch {
      // Already closed.
    }
    const term = setTimeout(() => {
      killProcessTree(this.child.pid, false, 'SIGTERM');
    }, gracePeriodMs);
    const kill = setTimeout(() => {
      killProcessTree(this.child.pid, true, 'SIGKILL');
    }, gracePeriodMs * 2);
    term.unref?.();
    kill.unref?.();
    await exited;
    clearTimeout(term);
    clearTimeout(kill);
  }
}
