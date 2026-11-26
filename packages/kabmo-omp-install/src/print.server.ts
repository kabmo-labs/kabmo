/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One-shot `omp -p` call: no session, no tools, no title.
 *
 * The goal auditor and the commit-message generator both need the same thing —
 * a model answer with no conversation, no tool access and no session file — so
 * the spawn lives here rather than in either caller. A second copy is how one
 * of them would keep `--no-tools` while the other quietly gained tool access.
 *
 * `--thinking off` is not a shortcut, it is the cost profile: measured on this
 * machine, a one-line reply took 26.7 s with reasoning on and 4.5 s with it
 * off. Both callers ask for a short text answer, not a task.
 *
 * The prompt goes on stdin, not on the command line: a diff or an excerpt can
 * be tens of kilobytes, and `omp -p` reads stdin when no message argument is
 * given.
 */

import { stripKabmoHostEnv } from '@kabmo-labs/kabmo-sdk';
import { resolveOmpBin } from '@kabmo-labs/kabmo-omp-cli';

export interface OmpPrintRequest {
  prompt: string;
  cwd: string;
  /** `provider/modelId`; omp's own default when absent. */
  model?: string;
  timeoutMs?: number;
}

export type OmpPrintOutcome =
  | { ok: true; text: string }
  | { ok: false; reason: 'no-binary' | 'timeout' | 'exit' | 'spawn'; detail?: string };

export interface OmpPrintDeps {
  resolveBin?: () => string | null;
}

const DEFAULT_TIMEOUT_MS = 60_000;
/** Enough of git's/omp's own words to name the failure, not a whole log. */
const STDERR_LIMIT = 2_000;

export async function runOmpPrint(
  request: OmpPrintRequest,
  deps: OmpPrintDeps = {},
): Promise<OmpPrintOutcome> {
  const bin = (deps.resolveBin ?? resolveOmpBin)();
  if (!bin) return { ok: false, reason: 'no-binary' };

  const args = ['-p', '--no-session', '--no-tools', '--no-lsp', '--thinking', 'off', '--cwd', request.cwd];
  if (request.model) args.push('--model', request.model);

  let timedOut = false;
  try {
    const proc = Bun.spawn({
      cmd: [bin, ...args],
      cwd: request.cwd,
      // A reader: no session, no tools, no title, and Kabmo's own port/password
      // must not leak into the child.
      env: stripKabmoHostEnv({ ...Bun.env, PI_NO_TITLE: '1' }, process.platform),
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      windowsHide: true,
    });

    const killer = setTimeout(() => {
      timedOut = true;
      void proc.kill();
    }, request.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
      proc.stdin.write(request.prompt);
      await proc.stdin.end();
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text().catch(() => ''),
        proc.exited,
      ]);
      if (timedOut) return { ok: false, reason: 'timeout' };
      if (exitCode !== 0) {
        return { ok: false, reason: 'exit', detail: stderr.trim().slice(0, STDERR_LIMIT) };
      }
      return { ok: true, text: stdout.trim() };
    } finally {
      clearTimeout(killer);
    }
  } catch (error) {
    // A spawn failure (out of descriptors, a bad cwd) is a call that could not
    // be taken, not an answer.
    return {
      ok: false,
      reason: 'spawn',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
