/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `proc://` card body.
 *
 * What this pins is that a process is drawn as a process: the state, pid,
 * uptime, exit code and log the result carries are on screen, and the panel is
 * reached from the `read`/`write` transport rather than from the tool name.
 * Before this, `write proc://kabmo-dev/kill` opened the EDIT panel (its
 * stdin payload rendered as "Written File Preview") and `read proc://ompdev`
 * opened the READ panel with `javascript` as the file kind.
 *
 * Rendered with `h()` against happy-dom, following `panels/Edit.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Proc } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Proc';
import { toolPanelKind } from '@/client/components/workspace/chat-timeline/tool-renderers/registry';
import type { ToolCallData } from '@/shared/types';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

async function mount(partial: Partial<ToolCallData> & Pick<ToolCallData, 'type'>) {
  const tool = { id: 'c1', name: partial.type, title: partial.type, ...partial } as ToolCallData;
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(Proc, { tool }), container);
  });
  return container;
}

const KILL: Partial<ToolCallData> & Pick<ToolCallData, 'type'> = {
  type: 'write',
  name: 'write',
  target: 'proc://kabmo-dev/kill',
  input: { path: 'proc://kabmo-dev/kill', content: null },
  output: 'Stopped kabmo-dev [service] — exited — up 16m29s',
  status: 'success',
  details: {
    proc: {
      action: 'stop',
      daemon: { name: 'kabmo-dev', state: 'exited', startedAt: 1_791_433_388_038, exitedAt: 1_791_434_377_079, exitCode: 0, restartCount: 0, outputBytes: 4540, persist: false, detached: false },
    },
  },
};

describe('Proc panel — a service the call named', () => {
  test('reaches the panel from the transport, not the tool name', () => {
    expect(toolPanelKind({ id: 'c1', type: 'write', name: 'write', title: 'write', target: 'proc://kabmo-dev/kill', input: { path: 'proc://kabmo-dev/kill' } } as ToolCallData)).toBe('proc');
  });

  test('states the state, the exit code and the span it ran', async () => {
    const el = await mount(KILL);
    const text = el.textContent ?? '';
    expect(text).toContain('kabmo-dev');
    expect(text).toContain('exited');
    expect(text).toContain('exit');
    expect(text).toContain('0');
    // `ran` — the span it ran, not the time since it started.
    expect(text).toContain('16m 29s');
    expect(text).toContain('ran');
  });

  test('does not render the stdin payload of a stop as file content', async () => {
    const el = await mount(KILL);
    expect(el.textContent ?? '').not.toContain('Written File Preview');
  });
});

describe('Proc panel — stdin write', () => {
  test('shows the payload it sent and the live pid', async () => {
    const el = await mount({
      type: 'write',
      name: 'write',
      target: 'proc://kabmo-dev',
      input: { path: 'proc://kabmo-dev', content: '{"id":"kabmo-dev","kill":true}' },
      output: 'Sent input to kabmo-dev [service] — ready — up 16m21s — pid 22985',
      status: 'success',
      details: { proc: { action: 'stdin', daemon: { name: 'kabmo-dev', state: 'ready', pid: 22985, startedAt: Date.now() - 981_000 }, input: '{"id":"kabmo-dev","kill":true}' } },
    });
    const text = el.textContent ?? '';
    expect(text).toContain('Stdin');
    expect(text).toContain('{"id":"kabmo-dev","kill":true}');
    expect(text).toContain('pid');
    expect(text).toContain('22985');
    expect(text).toContain('ready');
  });
});

describe('Proc panel — status read', () => {
  test('renders the log the result carried', async () => {
    const el = await mount({
      type: 'read',
      name: 'read',
      target: 'proc://ompdev',
      input: { path: 'proc://ompdev' },
      output: 'ompdev [service] — failed — pid 1234\n$ bun run dev\nboom',
      status: 'success',
      details: {
        proc: {
          daemon: { name: 'ompdev', state: 'failed', pid: 1234, startedAt: 1, exitedAt: 2, exitCode: 1 },
          log: '$ bun run dev\nboom',
          terminalRows: ['$ bun run dev', 'boom'],
        },
      },
    });
    const text = el.textContent ?? '';
    expect(text).toContain('failed');
    expect(text).toContain('bun run dev');
    expect(text).toContain('boom');
    expect(text).toContain('Log');
  });

  test('strips the ANSI runs omp puts in terminal rows', async () => {
    const el = await mount({
      type: 'read',
      name: 'read',
      target: 'proc://ompdev',
      input: { path: 'proc://ompdev' },
      output: 'ompdev [service] — ready',
      status: 'success',
      details: {
        proc: {
          daemon: { name: 'ompdev', state: 'ready', pid: 1, startedAt: 1 },
          log: '$ bun run dev',
          terminalRows: ['\u001b[0m\u001b[2;38;5;5m$\u001b[0m \u001b[0m\u001b[1;2mbun run dev'],
        },
      },
    });
    const text = el.textContent ?? '';
    expect(text).toContain('bun run dev');
    expect(text).not.toContain('\u001b');
  });
});

describe('Proc panel — the listing', () => {
  test('groups services, jobs and agents', async () => {
    const el = await mount({
      type: 'read',
      name: 'read',
      target: 'proc://',
      input: { path: 'proc://' },
      output: 'No background jobs or services.',
      status: 'success',
      details: {
        proc: {
          jobs: [{ id: 'bg_1', type: 'bash', status: 'running', label: 'bun run probe.ts', durationMs: 1200 }],
          agents: [{ id: 'Sleeper', activity: 'thinking', ageMs: 4200, live: true }],
          daemons: [{ name: 'omp.lsp.mux', state: 'ready', pid: 400, startedAt: 1 }],
        },
      },
    });
    const text = el.textContent ?? '';
    expect(text).toContain('Services');
    expect(text).toContain('omp.lsp.mux');
    expect(text).toContain('Jobs');
    expect(text).toContain('bg_1');
    expect(text).toContain('Agents');
    expect(text).toContain('Sleeper');
  });

  test('an empty listing says so instead of showing nothing', async () => {
    const el = await mount({
      type: 'read',
      name: 'read',
      target: 'proc://',
      input: { path: 'proc://' },
      output: '',
      status: 'success',
      details: { proc: { jobs: [], agents: [], daemons: [] } },
    });
    expect(el.textContent ?? '').toContain('No background jobs or services');
  });
});

describe('Proc panel — a cancelled job', () => {
  test('lists the outcome the kill reported', async () => {
    const el = await mount({
      type: 'write',
      name: 'write',
      target: 'proc://bg_2/kill',
      input: { path: 'proc://bg_2/kill' },
      output: 'Cancelled 1 background job(s).',
      status: 'success',
      details: {
        proc: {
          op: 'cancel',
          jobs: [{ id: 'bg_2', type: 'bash', status: 'cancelled', label: 'bun run tmp-rebind-smoke.ts', durationMs: 81_289 }],
          cancelled: [{ id: 'bg_2', status: 'cancelled' }],
        },
      },
    });
    const text = el.textContent ?? '';
    expect(text).toContain('Cancelled');
    expect(text).toContain('bg_2');
    expect(text).toContain('cancelled');
  });
});

describe('Proc panel — running-task telemetry', () => {
  // The same snapshot fields the wait card draws (omp 18.13.0). This row has no
  // percent chip of its own, so the line carries the estimate too.
  test('draws requests, spend, context fill and stage for a running task', async () => {
    const el = await mount({
      type: 'read',
      name: 'read',
      target: 'proc://bg_11',
      input: { path: 'proc://bg_11' },
      output: 'bg_11 [task] — running',
      status: 'running',
      details: {
        proc: {
          job: {
            id: 'bg_11', type: 'task', status: 'running', label: 'refactor', durationMs: 90_000,
            completionPercent: 55, requests: 90, cost: 18.4,
            contextTokens: 163_840, contextWindow: 1_048_576, stage: 'implementing',
          },
        },
      },
    });
    const text = el.textContent ?? '';
    expect(text).toContain('90 req');
    expect(text).toContain('$18.40');
    expect(text).toContain('ctx 163.8K/1.0M');
    expect(text).toContain('~55%');
    expect(text).toContain('stage: implementing');
  });
});

describe('Proc panel — legacy hub tool', () => {
  test('renders a hub daemon from the top level of details', async () => {
    const el = await mount({
      type: 'hub',
      input: { op: 'start', name: 'kabmo-dev', application: 'bun', args: ['run', 'dev'] },
      output: 'kabmo-dev [service] — ready — pid 22985',
      status: 'success',
      details: { op: 'start', daemon: { name: 'kabmo-dev', state: 'ready', pid: 22985, startedAt: 1 } },
    });
    const text = el.textContent ?? '';
    expect(text).toContain('kabmo-dev');
    expect(text).toContain('ready');
    expect(text).toContain('22985');
  });
});
