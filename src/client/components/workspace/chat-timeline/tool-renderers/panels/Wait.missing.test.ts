/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `wait` card for a call whose result is MISSING.
 *
 * Two shapes reach this suite, and both used to render as a generic tool:
 *
 *   - a page reloaded while the call blocks — the transcript holds the
 *     `toolCall` block and the `tool_execution_start` entry and no
 *     `toolResult`, so there is no `details` to read and the panel bailed out;
 *   - omp's own "Nothing to wait for" answer, which carries `details: {}`.
 *
 * Neither may claim a job list: an absent snapshot is UNKNOWN, not empty. The
 * clock comes from the start entry, which is the only one such a call has.
 *
 * Rendered with `h()` against happy-dom through the shared harness
 * (`wait-test-util.ts`); the live/settled half lives in `Wait.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { installWaitDom, mountWait as mount, restoreWaitDom, waitBar as bar } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/wait-test-util';
import type { ToolCallData } from '@/shared/types';

beforeAll(installWaitDom);
afterAll(restoreWaitDom);

describe('Wait panel — a reloaded mid-call wait', () => {
  // The transcript of a page reloaded while a wait blocks holds the `toolCall`
  // block and NO `toolResult`, so there is no `details` at all. The panel used
  // to require `details.op`, return nothing, and leave the card looking like a
  // generic tool: a title, an empty body. The tool's own name is the evidence
  // that this is a wait, and the start entry is its clock.
  const PENDING: Partial<ToolCallData> & Pick<ToolCallData, 'type'> = {
    type: 'wait',
    name: 'wait',
    status: 'running',
    startedAt: Date.now() - 5_000,
  };

  test('still draws the clock and the bar, not a generic Output block', async () => {
    const el = await mount(PENDING);
    expect(el.textContent ?? '').toContain('0:05');
    expect(el.textContent ?? '').toContain('waiting');
    expect(bar(el)).not.toBeNull();
  });

  test('claims no job list it does not have', async () => {
    const el = await mount(PENDING);
    const text = el.textContent ?? '';
    // No "Jobs" section, and no "no jobs" claim either: the list is UNKNOWN.
    expect(text).not.toContain('Jobs');
    expect(text).not.toContain('no jobs');
    expect(text).toContain('running');
  });

  test('an indeterminate bar, because nothing reported a position', async () => {
    const el = await mount(PENDING);
    expect(bar(el)?.getAttribute('aria-valuenow')).toBeNull();
    expect(bar(el)?.querySelector('.wait-bar-sweep')).not.toBeNull();
  });

  test("omp's own `details: {}` answer is not drawn as a jobless wait", async () => {
    // "Nothing to wait for: no background job or service you started is
    // running." carries `details: {}` — a real result with no snapshot.
    const el = await mount({
      type: 'wait',
      name: 'wait',
      status: 'error',
      output: 'Nothing to wait for: no background job or service you started is running.',
      details: {},
    });
    const text = el.textContent ?? '';
    expect(text).toContain('Nothing to wait for');
    expect(text).not.toContain('no jobs');
  });
});

describe('Wait panel — a result it cannot read', () => {
  test('still keeps the prose omp wrote beside the panel', async () => {
    // The panel is chosen by the TOOL, not by the result: a `wait` whose result
    // carries no snapshot is drawn as a wait and its text is kept, because the
    // sentence is the only record of what happened.
    const el = await mount({ type: 'wait', name: 'wait', status: 'success', output: 'Nothing to wait for.', details: {} });
    expect(el.textContent ?? '').toContain('Nothing to wait for.');
    // No clock is invented either: with no start entry and no measured span the
    // stopwatch reads `—`, which is the honest answer.
    expect(el.textContent ?? '').toContain('—');
  });

  test('a call whose result was never written says so', async () => {
    // The run died mid-call: omp wrote the start entry and nothing else, so
    // there is no snapshot AND no prose. An empty body read as a panel that
    // failed to draw.
    const el = await mount({ type: 'wait', name: 'wait', status: 'success', startedAt: Date.now() - 4_000 });
    expect(el.textContent ?? '').toContain('No result was recorded');
  });
});
