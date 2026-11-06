/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What `cancel` puts ON THE WIRE.
 *
 * `session/cancel` is a JSON-RPC NOTIFICATION, so nothing awaits it and a
 * failure to write it is invisible: the Stop button answered 500 from inside
 * `notify` (`undefined is not an object (evaluating 'this.write')`, because the
 * method reference lost its receiver) and the turn kept running. The transport
 * here is a real child that ECHOES every frame back, so the assertion is made
 * on what actually crossed the pipe — a stubbed `write` would have hidden the
 * defect, and a timer would have turned a missing frame into a flake.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcpProcess } from '@/server/lib/harness/acp/client';

const launched: AcpProcess[] = [];
const scratch: string[] = [];

interface Mounted {
  proc: AcpProcess;
  /** Resolves with the params of the first notification of `method`. */
  seen: (method: string) => Promise<Record<string, unknown>>;
}

async function mountProcess(): Promise<Mounted> {
  const dir = await mkdtemp(join(tmpdir(), 'kabmo-acp-cancel-'));
  scratch.push(dir);
  const waiting = new Map<string, (params: Record<string, unknown>) => void>();
  const proc = new AcpProcess({
    // Echo each frame verbatim, so a notification comes back as one.
    command: ['/bin/sh', '-c', 'while IFS= read -r line; do printf "%s\\n" "$line"; done'],
    cwd: dir,
    onNotification: (method, params) => waiting.get(method)?.(params),
  });
  launched.push(proc);
  return {
    proc,
    seen: (method) =>
      new Promise((resolve) => {
        waiting.set(method, resolve);
      }),
  };
}

afterEach(async () => {
  await Promise.all(launched.splice(0).map((proc) => proc.dispose(0)));
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('ACP cancel', () => {
  test('writes session/cancel for the session it was given', async () => {
    const { proc, seen } = await mountProcess();
    const echoed = seen('session/cancel');
    proc.cancel('acp-cancel-1');

    // The frame carries no `id`: a cancel is a notification, and one carrying an
    // id would leave a pending reply nobody consumes.
    expect(await echoed).toEqual({ sessionId: 'acp-cancel-1' });
  });
});