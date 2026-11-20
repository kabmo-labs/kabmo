/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A held replay's WORK is a notice too.
 *
 * Measured on agy 1.5.3 against a real 155 s run: the replay carried
 * `read_file` and a failed `run_command` after the holding sentence and NO new
 * assistant text, so a probe that waited for prose delivered nothing until its
 * ceiling. These cases pin the collection and the dedupe.
 */

import { describe, expect, test } from 'bun:test';
import { collectReplayFrame, newToolNotice, type ReplaySegment } from '@/server/lib/harness/acp/background-replay';
import { AcpBackgroundProbe } from '@/server/lib/harness/acp/background-work';

const seg = (): ReplaySegment => ({ text: '', sawUser: false, tools: [] });

describe('replay collection', () => {
  test('a tool_call and its update are ONE row, latest status kept', () => {
    const s = seg();
    collectReplayFrame(s, { sessionUpdate: 'tool_call', toolCallId: 't1', name: 'read_file', status: 'pending' });
    collectReplayFrame(s, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' });
    expect(s.tools).toEqual([{ id: 't1', name: 'read_file', status: 'completed' }]);
  });

  test('a user chunk starts a new segment', () => {
    const s = seg();
    collectReplayFrame(s, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old' } });
    collectReplayFrame(s, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'q' } });
    expect(s.text).toBe('');
    expect(s.sawUser).toBe(true);
  });

  test('the notice marks status and is reported once per call', () => {
    const s = seg();
    s.tools.push({ id: 'a', name: 'read_file', status: 'completed' }, { id: 'b', name: 'run_command', status: 'failed' });
    const reported = new Set<string>();
    expect(newToolNotice(s, reported)).toBe('The subagent continued working:\n✓ read_file\n✗ run_command');
    expect(newToolNotice(s, reported)).toBeNull();
  });

  test('a long list is summarized', () => {
    const s = seg();
    for (let i = 0; i < 7; i += 1) s.tools.push({ id: `t${i}`, name: 'run_command', status: 'completed' });
    expect(newToolNotice(s, new Set())).toContain('… and 2 more');
  });
});

describe('the probe against a textless replay', () => {
  test('a replay that only ran tools still reaches the operator', async () => {
    // A deterministic queue, not wall-clock sleeps: the probe's schedule is
    // injected, so each tick runs exactly one callback.
    const scheduled: Array<() => void> = [];
    const emitted: string[] = [];
    const run = async (ticks: number): Promise<void> => {
      for (let i = 0; i < ticks; i += 1) {
        const next = scheduled.shift();
        next?.();
        for (let hop = 0; hop < 8; hop += 1) await Promise.resolve();
      }
    };
    let probe!: AcpBackgroundProbe;
    probe = new AcpBackgroundProbe({
      load: async () => {
        probe.consume('session/update', { update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'buat banner' } } });
        probe.consume('session/update', { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Siap, langsung saya buatkan.' } } });
        probe.consume('session/update', { update: { sessionUpdate: 'tool_call', toolCallId: 'r1', name: 'read_file', status: 'completed' } });
        probe.consume('session/update', { update: { sessionUpdate: 'tool_call', toolCallId: 'c1', name: 'run_command', status: 'failed' } });
        return {};
      },
      resetIdle: () => {},
      emit: (text) => emitted.push(text),
      firstDelayMs: 1,
      maxDelayMs: 2,
      now: () => 0,
      schedule: (fn) => {
        scheduled.push(fn);
        return scheduled.length;
      },
      cancel: () => {},
    });
    probe.start('Siap, langsung saya buatkan.');
    await run(1);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toContain('✓ read_file');
    expect(emitted[0]).toContain('✗ run_command');
    // Each new tool call re-arms the probe, so a repeated replay is silent.
    await run(3);
    expect(emitted).toHaveLength(1);
    probe.stop();
  });
});

describe('the absolute ceiling', () => {
  test('new work re-arms the quiet window but never past the lifetime', async () => {
    const scheduled: Array<() => void> = [];
    const emitted: string[] = [];
    let clock = 0;
    let tool = 0;
    let probe!: AcpBackgroundProbe;
    const run = async (): Promise<void> => {
      for (let i = 0; i < 12; i += 1) {
        const next = scheduled.shift();
        if (!next) return;
        next();
        for (let hop = 0; hop < 8; hop += 1) await Promise.resolve();
      }
    };
    probe = new AcpBackgroundProbe({
      load: async () => {
        tool += 1;
        probe.consume('session/update', { update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'q' } } });
        probe.consume('session/update', { update: { sessionUpdate: 'tool_call', toolCallId: `t${tool}`, name: 'run_command', status: 'pending' } });
        return {};
      },
      resetIdle: () => {},
      emit: (text) => emitted.push(text),
      timeoutMs: 1_000,
      firstDelayMs: 1,
      maxDelayMs: 1,
      // Each probe advances the clock by 20 minutes: past the hour after three.
      now: () => clock,
      schedule: (fn) => {
        clock += 20 * 60_000;
        scheduled.push(fn);
        return scheduled.length;
      },
      cancel: () => {},
    });
    probe.start('');
    await run();
    expect(emitted.length).toBeGreaterThanOrEqual(2);
    // The ceiling stops it; nothing is scheduled after it.
    expect(scheduled).toHaveLength(0);
  });
});
