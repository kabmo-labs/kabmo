/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `rg` behind the Search panel — a native one when the machine has it.
 *
 * The `ripgrep` package is a WASI build (732 KiB of wasm) whose guest sees a
 * single preopened directory. That costs two things. Speed: measured 86–117 ms
 * against 37 ms for the same query in this repo. And correctness: the guest
 * cannot reach the user's global gitignore, so a path git refuses to track —
 * `~/.gitignore` excludes `AGENTS.md` on this machine — was listed as a search
 * hit while the Files and Git panels both hid it.
 *
 * A native `rg` on PATH answers both, but `Bun.which` alone is not enough to
 * find one: the first `rg` on PATH in this repo is `node_modules/.bin/rg`, the
 * WASI shim itself (`#!/usr/bin/env node`). Resolving by hand lets a script be
 * skipped and the next PATH entry considered. When no native binary exists the
 * WASI build still runs, because the panel has to work on a machine that never
 * installed ripgrep.
 */

import { join } from 'path';
import { ripgrep } from 'ripgrep';
import { childEnv } from '@/server/lib/fs/child-env';

/** Bytes that open a script rather than an executable (`#!`). */
const SHEBANG_MAGIC = [0x23, 0x21] as const;

export interface RipgrepSink {
  /** Raw stdout, chunk by chunk, as rg flushes it. */
  onStdout: (chunk: Uint8Array) => void;
  /** Raw stderr, chunk by chunk, as rg flushes it. */
  onStderr: (chunk: Uint8Array) => void;
  /**
   * Fires once the walk must stop — the search route's result cap. The child is
   * killed, because leaving it walking a tree nobody is reading would keep the
   * whole scan's cost while discarding its output.
   */
  signal?: AbortSignal;
}

let resolvedBinary: string | null | undefined;

/**
 * Path of a native `rg`, or null when PATH holds only scripts.
 *
 * Cached for the process: PATH does not move under a running server, and the
 * answer costs one 2-byte read per candidate. A binary is recognised by *not*
 * starting with `#!` — that covers ELF, Mach-O (thin and fat) and PE without
 * enumerating magics, and a wrong guess only costs a failed spawn, which falls
 * back to the WASI build.
 */
export async function nativeRipgrepPath(): Promise<string | null> {
  if (resolvedBinary !== undefined) return resolvedBinary;
  resolvedBinary = null;

  const executable = process.platform === 'win32' ? 'rg.exe' : 'rg';
  for (const dir of (Bun.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    if (!dir) continue;
    const candidate = join(dir, executable);
    try {
      const head = await Bun.file(candidate).slice(0, 2).bytes();
      if (head.length < 2) continue;
      if (head[0] === SHEBANG_MAGIC[0] && head[1] === SHEBANG_MAGIC[1]) continue;
      resolvedBinary = candidate;
      break;
    } catch {
      // Not there, or not readable — try the next PATH entry.
    }
  }
  return resolvedBinary;
}

/**
 * Run `rg` with `args` in `cwd`, streaming both pipes into `sink`.
 *
 * Returns rg's exit code (0 = matches, 1 = none, 2 = error). A native binary
 * that disappears between resolution and spawn falls back to WASI rather than
 * failing the search.
 */
export async function runRipgrep(args: string[], cwd: string, sink: RipgrepSink): Promise<number> {
  const binary = await nativeRipgrepPath();
  if (binary) {
    try {
      const proc = Bun.spawn({
        env: childEnv(),
        cmd: [binary, ...args],
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      // A run that has hit the route's cap is killed rather than drained: its
      // remaining output is discarded, so leaving it walking the tree would
      // spend the whole scan's cost for nothing.
      const onAbort = () => proc.kill();
      sink.signal?.addEventListener('abort', onAbort, { once: true });
      // `pipeTo`, not `for await`: the repo's lib set has no
      // `ReadableStream[Symbol.asyncIterator]`, and this is the same shape
      // `lib/omp/rpc/lines.ts` uses to drain a Bun child.
      const pump = (stream: ReadableStream<Uint8Array>, write: (chunk: Uint8Array) => void) =>
        stream.pipeTo(
          new WritableStream({
            write(chunk) {
              write(chunk);
            },
          }),
        ).then(
          () => undefined,
          () => undefined,
        );
      // Drained together: rg filling one pipe while the other is unread would
      // otherwise block it against a full buffer.
      try {
        await Promise.all([pump(proc.stdout, sink.onStdout), pump(proc.stderr, sink.onStderr)]);
        return await proc.exited;
      } finally {
        sink.signal?.removeEventListener('abort', onAbort);
      }
    } catch {
      // Spawn refused (deleted, not executable) — the WASI build still answers.
    }
  }

  // WASI preopens map the guest "." onto the real target directory. The WASI
  // build runs the whole walk inside this process and exposes no way to cancel
  // it, so an abort here only stops the CALLER from using the output — the
  // sink's own cap check is what keeps the frames bounded.
  const preopens = { '.': cwd };
  const { code } = await ripgrep(args, {
    preopens,
    // ripgrep accepts any `{ write(chunk) }` sink — feed it the raw stream so
    // matches flush incrementally.
    stdout: { write: (chunk: Uint8Array) => sink.onStdout(chunk) },
    stderr: { write: (chunk: Uint8Array) => sink.onStderr(chunk) },
  });
  return code;
}
