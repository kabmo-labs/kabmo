/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Running one update step, and reading a child's output as it arrives.
 *
 * Split out of `./install` because the parent file sits at the repository's
 * per-file ceiling and this half is a self-contained child-process concern: a
 * synchronous probe used for git facts, one step runner, and the streaming
 * drain both the Kabmo and the oh-my-pi update paths share.
 */

/** A client rebuild is slow, but a hung child is worse. */
export const STEP_TIMEOUT_MS = 600_000;
/** Cap on the captured output returned to the console. */
export const OUTPUT_LIMIT = 20_000;

export interface UpdateStep {
  label: string;
  cmd: string[];
  cwd: string;
}

export function runSync(cmd: string[], cwd?: string): { ok: boolean; out: string } {
  try {
    const proc = Bun.spawnSync({
      cmd,
      cwd,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 15_000,
    });
    return { ok: proc.exitCode === 0, out: proc.stdout.toString().trim() };
  } catch {
    return { ok: false, out: '' };
  }
}

/**
 * Drain a child's stdout/stderr, forwarding each chunk to `sink` as it arrives
 * and returning the whole decoded text. Exported because the omp update path
 * needs the same streaming read: buffering with `new Response(stream).text()`
 * emits nothing until the process exits, which is exactly what makes an update
 * look hung.
 */
export async function pumpStream(stream: ReadableStream<Uint8Array>, sink?: (chunk: string) => void): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk.length === 0) continue;
    text += chunk;
    sink?.(chunk);
  }
  return text;
}

export async function runStep(step: UpdateStep, onLine?: (chunk: string) => void): Promise<{ ok: boolean; exitCode: number | null; output: string }> {
  const proc = Bun.spawn({
    cmd: step.cmd,
    cwd: step.cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: STEP_TIMEOUT_MS,
    env: { ...Bun.env, PAGER: 'cat', FORCE_COLOR: '0' },
  });
  const [stdout, stderr] = await Promise.all([pumpStream(proc.stdout, onLine), pumpStream(proc.stderr, onLine)]);
  const exitCode = await proc.exited;
  return { ok: exitCode === 0, exitCode, output: `${stdout}${stderr}`.trim() };
}

export function tail(text: string): string {
  return text.length > OUTPUT_LIMIT ? `…\n${text.slice(-OUTPUT_LIMIT)}` : text;
}
