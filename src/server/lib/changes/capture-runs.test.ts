/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Run separation: a run is not every `agent_end`.
 *
 * omp emits a non-terminal `agent_end` while an async subagent is still
 * working, and a retry re-enters `agent_start` without one. The capture must
 * reuse the run id across both, close only on a terminal end, and keep the
 * closed id so a subagent's late write still carries the run that started it.
 *
 * Paths go through `at()`, so the fixture is native on Windows too.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { makeCapture, records, REPO } from '@/server/lib/changes/capture-test-util';

let dataDir = '';
let original: string | undefined;

beforeAll(async () => {
  original = Bun.env.KABMO_DATA_DIR;
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kabmo-changes-runs-'));
  Bun.env.KABMO_DATA_DIR = dataDir;
});

afterAll(async () => {
  if (original === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = original;
  await fsp.rm(dataDir, { recursive: true, force: true });
});

/** A path inside the fixture repo, spelled the way the host spells it. */
function at(relative: string): string {
  return path.join(REPO, relative);
}

describe('runs', () => {
  test('agent_start opens a run and the change carries its id', async () => {
    const files = new Map([[at('a.ts'), 'old']]);
    const capture = makeCapture('cap-run', files);
    capture.onFrame({ type: 'agent_start' });
    capture.onFrame({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'edit', args: { path: 'a.ts' } });
    await capture.flush();
    files.set(at('a.ts'), 'new');
    capture.onFrame({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'edit' });
    await capture.flush();

    const lines = await records('cap-run');
    const start = lines.find((line) => line.type === 'run' && line.phase === 'start');
    const change = lines.find((line) => line.type === 'change');
    expect(start?.type).toBe('run');
    expect(change?.type).toBe('change');
    if (start?.type !== 'run' || change?.type !== 'change') throw new Error('expected records');
    expect(change.runId).toBe(start.runId);
    expect(change.runAt).toBe(start.at);
  });

  test('a non-terminal agent_end is a continuation: the run id is reused', async () => {
    const files = new Map([[at('a.ts'), 'old']]);
    const capture = makeCapture('cap-run-cont', files);
    capture.onFrame({ type: 'agent_start' });
    capture.onFrame({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'edit', args: { path: 'a.ts' } });
    await capture.flush();
    files.set(at('a.ts'), 'new');
    capture.onFrame({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'edit' });
    capture.onFrame({ type: 'agent_end', isTerminal: false });
    capture.onFrame({ type: 'agent_start' });
    capture.onFrame({ type: 'tool_execution_start', toolCallId: 'c2', toolName: 'edit', args: { path: 'a.ts' } });
    await capture.flush();
    files.set(at('a.ts'), 'newer');
    capture.onFrame({ type: 'tool_execution_end', toolCallId: 'c2', toolName: 'edit' });
    await capture.flush();

    const lines = await records('cap-run-cont');
    expect(lines.filter((line) => line.type === 'run').map((line) => line.phase)).toEqual(['start']);
    const changes = lines.filter((line) => line.type === 'change');
    expect(changes.length).toBe(2);
    if (changes[0]?.type !== 'change' || changes[1]?.type !== 'change') throw new Error('expected changes');
    expect(changes[0].runId).toBe(changes[1].runId);
  });

  test('a terminal agent_end closes the run and the next start opens a new one', async () => {
    const files = new Map([[at('b.ts'), 'old']]);
    const capture = makeCapture('cap-run-new', files);
    capture.onFrame({ type: 'agent_start' });
    capture.onFrame({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'edit', args: { path: 'b.ts' } });
    await capture.flush();
    files.set(at('b.ts'), 'new');
    capture.onFrame({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'edit' });
    capture.onFrame({ type: 'agent_end', isTerminal: true });
    await capture.flush();
    capture.onFrame({ type: 'agent_start' });
    capture.onFrame({ type: 'tool_execution_start', toolCallId: 'c2', toolName: 'edit', args: { path: 'b.ts' } });
    await capture.flush();
    files.set(at('b.ts'), 'newer');
    capture.onFrame({ type: 'tool_execution_end', toolCallId: 'c2', toolName: 'edit' });
    await capture.flush();

    const lines = await records('cap-run-new');
    expect(lines.filter((line) => line.type === 'run').map((line) => line.phase)).toEqual(['start', 'end', 'start']);
    const changes = lines.filter((line) => line.type === 'change');
    if (changes[0]?.type !== 'change' || changes[1]?.type !== 'change') throw new Error('expected changes');
    expect(changes[0].runId).not.toBe(changes[1].runId);
  });

  test('a change after the terminal end keeps the closed run id', async () => {
    const files = new Map([[at('c.ts'), 'old']]);
    const capture = makeCapture('cap-run-late', files);
    capture.onFrame({ type: 'agent_start' });
    capture.onFrame({ type: 'agent_end', isTerminal: true });
    await capture.flush();
    capture.onFrame({
      type: 'subagent_event',
      payload: { type: 'tool_execution_start', toolCallId: 's1', toolName: 'edit', args: { path: 'c.ts' }, agent: 'Child' },
    });
    await capture.flush();
    files.set(at('c.ts'), 'new');
    capture.onFrame({
      type: 'subagent_event',
      payload: { type: 'tool_execution_end', toolCallId: 's1', toolName: 'edit', agent: 'Child' },
    });
    await capture.flush();

    const lines = await records('cap-run-late');
    const start = lines.find((line) => line.type === 'run' && line.phase === 'start');
    const change = lines.find((line) => line.type === 'change');
    if (start?.type !== 'run' || change?.type !== 'change') throw new Error('expected records');
    expect(change.runId).toBe(start.runId);
  });
});
