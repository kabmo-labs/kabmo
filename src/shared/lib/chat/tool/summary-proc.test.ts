/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The collapsed card's line for a `proc://` call and for a `bash` that started
 * a service.
 *
 * Split from `summary.test.ts` (which is at the repo's size ceiling) but the
 * same contract: the facts describe the PROCESS, never the transport the call
 * rode in on. `write proc://<id>` used to report `1 lines` — the line count of
 * its own stdin payload — and `read proc://<id>` the service log as a file.
 *
 * Pure function, no mounting.
 */

import { describe, expect, test } from 'bun:test';
import { toolSummary } from '@/shared/lib/chat/tool/summary';
import type { ToolCallData } from '@/shared/types/chat';

function tool(partial: Partial<ToolCallData> & Pick<ToolCallData, 'type'>): ToolCallData {
  return { id: 'c1', name: partial.type, title: partial.type, ...partial } as ToolCallData;
}

describe('toolSummary — proc://', () => {
  test('states the service outcome, not the transport', () => {
    const summary = toolSummary(tool({
      type: 'write',
      target: 'proc://kabmo-dev/kill',
      input: { path: 'proc://kabmo-dev/kill', content: null },
      output: 'Stopped kabmo-dev [service] — exited — up 16m29s',
      details: {
        proc: {
          action: 'stop',
          daemon: { name: 'kabmo-dev', state: 'exited', startedAt: 1_791_433_388_038, exitedAt: 1_791_434_377_079, exitCode: 0 },
        },
      },
    }));
    expect(summary?.line).toBe('stop · exited · ran 16m 29s · exit 0');
  });

  test('a stdin write reports the service, not the payload size', () => {
    const startedAt = Date.now() - 981_000;
    const summary = toolSummary(tool({
      type: 'write',
      target: 'proc://kabmo-dev',
      input: { path: 'proc://kabmo-dev', content: '{"id":"kabmo-dev","kill":true}' },
      output: 'Sent input to kabmo-dev [service] — ready — up 16m21s — pid 22985',
      details: { proc: { action: 'stdin', daemon: { name: 'kabmo-dev', state: 'ready', pid: 22985, startedAt } } },
    }));
    // `1 lines` (the old shape, from `input.content`) is the bug this pins.
    expect(summary?.line).not.toContain('1 lines');
    expect(summary?.line).toContain('stdin · ready');
    expect(summary?.line).toContain('pid 22985');
  });

  test('a listing counts every process it found', () => {
    const summary = toolSummary(tool({
      type: 'read',
      target: 'proc://',
      input: { path: 'proc://' },
      output: 'No background jobs or services.',
      details: { proc: { jobs: [{ id: 'bg_1', status: 'running' }], daemons: [{ name: 'omp.lsp.mux', state: 'ready' }], agents: [] } },
    }));
    expect(summary?.line).toBe('2 processes · 1 running');
  });

  test('a job read reports its id and elapsed time', () => {
    const summary = toolSummary(tool({
      type: 'read',
      target: 'proc://bg_10',
      input: { path: 'proc://bg_10' },
      details: { proc: { job: { id: 'bg_10', type: 'bash', status: 'running', durationMs: 147_461 } } },
    }));
    expect(summary?.line).toBe('list · running · bg_10 · 2m 27s');
  });

  test('a cancelled job names the count, not a phantom live process', () => {
    const summary = toolSummary(tool({
      type: 'write',
      target: 'proc://bg_2/kill',
      input: { path: 'proc://bg_2/kill' },
      details: { proc: { op: 'cancel', jobs: [{ id: 'bg_2', status: 'cancelled' }], cancelled: [{ id: 'bg_2', status: 'cancelled' }] } },
    }));
    expect(summary?.line).toBe('1 job cancelled');
  });

  test('the legacy hub tool reads the same way', () => {
    const summary = toolSummary(tool({
      type: 'hub',
      input: { op: 'start', name: 'kabmo-dev' },
      details: { op: 'start', daemon: { name: 'kabmo-dev', state: 'ready', pid: 22985, startedAt: 1 } },
    }));
    expect(summary?.line).toContain('start · ready');
    expect(summary?.line).toContain('pid 22985');
  });
});

describe('toolSummary — bash service launch', () => {
  test('names the service a bash started', () => {
    const summary = toolSummary(tool({
      type: 'bash',
      input: { command: 'bun run dev', name: 'kabmo-dev' },
      details: { service: { name: 'kabmo-dev', state: 'ready', ready: true, timedOut: false, pid: 22985 } },
    }));
    expect(summary?.line).toContain('kabmo-dev · ready');
    expect(summary?.line).toContain('pid 22985');
  });

  test('a plain command still reports its wall time', () => {
    const summary = toolSummary(tool({
      type: 'bash',
      details: { exitCode: 0, wallTimeMs: 28 },
    }));
    expect(summary?.line).toBe('exit 0 · 28ms');
  });
});
