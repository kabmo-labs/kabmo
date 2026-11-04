/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The transport faults `RpcProcess` has to survive.
 *
 * Two behaviours are pinned here, and neither can be observed against a real
 * child (omp 18.16.0 advertises one set of ceilings and never emits a malformed
 * chunk), so the scripted child says what the test needs:
 *
 * - **The ceilings come from `ready`.** The same chunk record is valid under
 *   the default 1 MiB physical ceiling and invalid under an advertised 4 MiB
 *   one — a 2 MiB logical frame is never chunked at 4 MiB — so the two runs
 *   differ only in what the server advertised.
 * - **A malformed chunk sequence does not kill the session.** It used to call
 *   `dispose(0)`, which took the child's LSP servers, browser targets and
 *   prewarm slot down for a transport fault; now the reader reports a notice,
 *   loses that one logical frame, and keeps answering.
 */

import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describePosix } from '@/test-support/platform';
import { RpcProcess, type RpcFrame } from '@/server/lib/omp/rpc/process';

const FAKE_OMP = join(import.meta.dir, '../../../../test-support/fake-omp-frames.ts');

const started: RpcProcess[] = [];
let root = '';

function start(env: Record<string, string>): { proc: RpcProcess; frames: RpcFrame[] } {
  root ||= mkdtempSync(join(tmpdir(), 'omp-frames-test-'));
  const frames: RpcFrame[] = [];
  const proc = new RpcProcess({
    cwd: root,
    env,
    onFrame: (frame) => frames.push(frame),
    dependencies: { resolveOmpBin: () => FAKE_OMP },
  });
  started.push(proc);
  return { proc, frames };
}

/** Ready + v2 negotiation, the state every chunk test needs. */
async function negotiated(env: Record<string, string>): Promise<{ proc: RpcProcess; frames: RpcFrame[] }> {
  const { proc, frames } = start(env);
  const ready = await proc.waitReady(20_000);
  await proc.negotiateProtocol(ready);
  return { proc, frames };
}

afterEach(async () => {
  for (const proc of started.splice(0)) await proc.dispose(500);
  if (root) {
    rmSync(root, { recursive: true, force: true });
    root = '';
  }
});

describePosix('RpcProcess framing', () => {
  test('the advertised frame ceiling is what the decoder applies', async () => {
    // 4 MiB advertised: a 2 MiB logical frame is below it, so it would never be
    // chunked — the record is a protocol fault and must be reported, once.
    const { proc, frames } = await negotiated({
      FAKE_OMP_READY_MAX_FRAME_BYTES: String(4 * 1024 * 1024),
      FAKE_OMP_CHUNK: 'valid-1mib',
    });

    const result = await proc.sendCommand<{ exitCode?: number }>({ type: 'bash', command: 'true' }, 20_000);

    // The response still arrived: the reader continued past the bad record.
    expect(result.exitCode).toBe(0);
    const notices = frames.filter((frame) => frame.type === 'notice');
    expect(notices).toHaveLength(1);
    expect(String(notices[0].message)).toContain('malformed RPC frame');
    expect(proc.isAlive).toBe(true);
  }, 30_000);

  test('the same record is accepted under the default ceiling', async () => {
    // Control for the test above: identical bytes, no advertised override. The
    // record is a valid FIRST slice, so nothing is reported and nothing is lost.
    const { proc, frames } = await negotiated({ FAKE_OMP_CHUNK: 'valid-1mib' });

    const result = await proc.sendCommand<{ exitCode?: number }>({ type: 'bash', command: 'true' }, 20_000);

    expect(result.exitCode).toBe(0);
    expect(frames.filter((frame) => frame.type === 'notice')).toHaveLength(0);
  }, 30_000);

  test('a malformed sequence costs one frame, not the child', async () => {
    const { proc, frames } = await negotiated({ FAKE_OMP_CHUNK: 'bad-index' });

    await proc.sendCommand({ type: 'bash', command: 'true' }, 20_000);
    expect(frames.filter((frame) => frame.type === 'notice')).toHaveLength(1);

    // The session is still there: a later command is answered by the SAME child.
    const state = await proc.sendCommand<{ sessionId?: string }>({ type: 'get_state' }, 20_000);
    expect(state.sessionId).toBe('fake-session');
    expect(proc.isAlive).toBe(true);
  }, 30_000);
});
