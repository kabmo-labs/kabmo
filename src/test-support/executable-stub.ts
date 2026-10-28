/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * An executable stand-in for a spawned program, on every platform.
 *
 * A dozen suites need to point `KABMO_OMP_BIN` (or `git`, or `rg`) at a
 * script they wrote, so the code under test spawns THEIR answer instead of the
 * real binary. The obvious shape is a `#!/bin/sh` file chmod-ed `0755`, and on
 * POSIX that works.
 *
 * It cannot work on Windows, and not for a reason a test can work around:
 * `Bun.spawn` resolves a program through libuv's `search_path`, which tries only
 * `.com` and `.exe` — "Since CreateProcess can start only .com and .exe files,
 * only those extensions are tried". A shell script, a `.cmd`, and a `.bat` are
 * all unspawnable however they are named or chmod-ed. That is why those suites
 * were skipped there.
 *
 * `Bun.build({ compile: true })` produces a real executable from the same source
 * — `.exe` on Windows, a native binary on POSIX — so ONE fixture serves both
 * platforms and no suite has to skip. Measured cost: ~160 ms and ~68 MB per
 * compile (the Bun runtime is embedded), which is why the result is cached by
 * content and why callers should compile once per suite, not per test.
 *
 * The source is a Bun program, so it keeps the ergonomics the scripts had:
 * `process.env`, `Bun.stdin.stream()`, `console.log`.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Where compiled fixtures live, so a suite re-run reuses them. */
const CACHE_ROOT = join(tmpdir(), 'kabmo-test-bins');

/**
 * Compile `source` into an executable and return its path.
 *
 * Cached by the source's own hash, so the same stub compiled by several suites
 * costs one build per `bun test` run. The extension is `.exe` on Windows because
 * that is what makes it startable there.
 */
export async function executableStub(source: string, label = 'stub'): Promise<string> {
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 16);
  const dir = join(CACHE_ROOT, `${label}-${hash}`);
  const outfile = join(dir, process.platform === 'win32' ? `${label}.exe` : label);

  // A cached build is reused as-is: the hash covers the source, and a partially
  // written file cannot exist here because the build writes it atomically.
  if (existsSync(outfile) && statSync(outfile).size > 0) return outfile;

  mkdirSync(dir, { recursive: true });
  const entry = join(dir, `${label}.ts`);
  await Bun.write(entry, source);

  const result = Bun.spawnSync({
    cmd: [process.execPath, 'build', entry, '--compile', '--outfile', outfile],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `could not compile the ${label} stub:\n${result.stderr.toString() || result.stdout.toString()}`,
    );
  }
  // The source is only an input; leaving it beside the binary would make the
  // cache directory grow with one file per suite for no benefit.
  rmSync(entry, { force: true });
  return outfile;
}

/**
 * A stub that answers omp's RPC wire protocol from `FAKE_OMP_RESPONSES`.
 *
 * Four suites wrote this same script by hand. Keeping it here means one copy to
 * fix when the protocol moves, and — the reason it exists — one executable that
 * works on Windows, where the hand-written `#!/usr/bin/env bun` version could not
 * be spawned at all.
 */
export const OMP_RPC_STUB_SOURCE = `#!/usr/bin/env bun
const responses = JSON.parse(process.env.FAKE_OMP_RESPONSES || '{}');
const encoder = new TextEncoder();
const write = (value) => process.stdout.write(encoder.encode(JSON.stringify(value) + '\\n'));
write({ type: 'ready' });
const decoder = new TextDecoder();
let buffer = '';
for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk);
  let index = buffer.indexOf('\\n');
  while (index >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf('\\n');
    if (!line.trim()) continue;
    const frame = JSON.parse(line);
    write({ type: 'response', id: frame.id, command: frame.type, success: true, data: responses[frame.type] ?? {} });
  }
}
`;

/** The shared RPC responder, compiled. */
export function ompRpcStub(): Promise<string> {
  return executableStub(OMP_RPC_STUB_SOURCE, 'fake-omp-rpc');
}
