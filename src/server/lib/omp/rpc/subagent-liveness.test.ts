/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import { SubagentLiveness } from '@/server/lib/omp/rpc/subagent-liveness';

const NOW = 1_000_000;
const STALE_MS = 60_000;

describe('SubagentLiveness', () => {
  test('counts a started subagent until its terminal lifecycle arrives', () => {
    const live = new SubagentLiveness();
    live.observe({ type: 'subagent_lifecycle', payload: { id: 's1', status: 'started', index: 0 } }, NOW);
    expect(live.liveCount(NOW, STALE_MS)).toBe(1);

    live.observe({ type: 'subagent_lifecycle', payload: { id: 's1', status: 'completed', index: 0 } }, NOW + 1);
    expect(live.liveCount(NOW + 1, STALE_MS)).toBe(0);
  });

  test('an id-less progress frame lands on the lifecycle entry it names', () => {
    const live = new SubagentLiveness();
    live.observe({ type: 'subagent_lifecycle', payload: { id: 's1', status: 'started', index: 3 } }, NOW);
    live.observe({ type: 'subagent_progress', payload: { index: 3, status: 'running' } }, NOW + 1);
    expect(live.liveCount(NOW + 1, STALE_MS)).toBe(1);

    // A terminal progress frame for the same index must clear that one entry —
    // not leave a second key behind holding the session open.
    live.observe({ type: 'subagent_progress', payload: { index: 3, status: 'completed' } }, NOW + 2);
    expect(live.liveCount(NOW + 2, STALE_MS)).toBe(0);
  });

  test('reads a progress snapshot nested under `progress`', () => {
    const live = new SubagentLiveness();
    live.observe({ type: 'subagent_progress', payload: { progress: { id: 's9', status: 'running' } } }, NOW);
    expect(live.liveCount(NOW, STALE_MS)).toBe(1);
  });

  test('malformed frames never fabricate liveness', () => {
    const live = new SubagentLiveness();
    live.observe({ type: 'subagent_lifecycle', payload: { id: 's1', status: 'paused' } }, NOW);
    live.observe({ type: 'subagent_lifecycle', payload: { status: 'started' } }, NOW);
    live.observe({ type: 'subagent_progress', payload: 'nonsense' }, NOW);
    live.observe({ type: 'subagent_event', payload: { event: { type: 'message_end' } } }, NOW);
    expect(live.liveCount(NOW, STALE_MS)).toBe(0);
  });

  test('a subagent silent past the stale window stops counting, so one lost terminal frame cannot pin a session', () => {
    const live = new SubagentLiveness();
    live.observe({ type: 'subagent_lifecycle', payload: { id: 's1', status: 'started', index: 0 } }, NOW);
    expect(live.liveCount(NOW + STALE_MS + 1, STALE_MS)).toBe(0);
  });

  test('an unattributed event refreshes tracked work without inventing an entry', () => {
    const live = new SubagentLiveness();
    live.observe({ type: 'subagent_lifecycle', payload: { id: 's1', status: 'started', index: 0 } }, NOW);
    live.observe({ type: 'subagent_event', payload: { event: { type: 'tool_execution_start', toolName: 'bash' } } }, NOW + STALE_MS - 1);
    expect(live.liveCount(NOW + STALE_MS + 1, STALE_MS)).toBe(1);
  });
});
