/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * ACP `plan` entries as the Todos panel reads them.
 *
 * The panel has one payload shape for both transports; an entry it cannot
 * classify is pending, never dropped or invented as done.
 */

import { describe, expect, test } from 'bun:test';
import { buildAcpTodos } from '@/server/lib/harness/acp/acp-todos.server';

describe('buildAcpTodos', () => {
  test('maps content and status into one phase with a real roll-up', () => {
    const state = buildAcpTodos([
      { content: 'Read the loader', status: 'completed' },
      { content: 'Extract the parser', status: 'in_progress' },
      { content: 'Run the suite', status: 'pending' },
    ]);
    expect(state.snapshot?.phases).toEqual([{
      name: 'Plan',
      tasks: [
        { content: 'Read the loader', status: 'completed' },
        { content: 'Extract the parser', status: 'in_progress' },
        { content: 'Run the suite', status: 'pending' },
      ],
    }]);
    expect(state.progress).toMatchObject({ total: 3, completed: 1, inProgress: 1, pending: 1 });
  });

  test('an empty or malformed plan is no snapshot, not an empty phase', () => {
    expect(buildAcpTodos([]).snapshot).toBeNull();
    expect(buildAcpTodos([{ status: 'completed' }, null, 7]).snapshot).toBeNull();
  });

  test('an unknown status reads pending rather than completed', () => {
    const state = buildAcpTodos([{ content: 'Do it', status: 'weird' }]);
    expect(state.snapshot?.phases[0]?.tasks[0]?.status).toBe('pending');
  });
});
