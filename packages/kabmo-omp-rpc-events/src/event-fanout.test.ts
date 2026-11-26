/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The fan-out's two listener lists.
 *
 * `on` is the ordinary stream every subscriber reads; `onRaw` runs first, before
 * `stripShellTrace` mutates the frame in place. The change journal is the only
 * raw listener: it needs the shell trace, and every other subscriber must not
 * pay for it.
 */

import { describe, expect, test } from 'bun:test';
import { EventFanout } from './event-fanout';
import type { AgentEvent } from '@kabmo-labs/kabmo-omp-rpc-protocol/constants';

describe('EventFanout raw listeners', () => {
  test('a raw listener sees the shell trace before the strip', () => {
    const fanout = new EventFanout();
    let rawTrace: unknown;
    let normalTrace: unknown;
    fanout.onRaw((event) => {
      rawTrace = (event.result as { details?: { trace?: unknown } } | undefined)?.details?.trace;
    });
    fanout.on((event) => {
      normalTrace = (event.result as { details?: { trace?: unknown } } | undefined)?.details?.trace;
    });
    fanout.emit({
      type: 'tool_execution_end',
      result: { content: [], details: { exitCode: 0, trace: { v: 1 } } },
    } as unknown as AgentEvent);
    expect(rawTrace).toEqual({ v: 1 });
    expect(normalTrace).toBeUndefined();
  });

  test('a throwing raw listener does not starve the ordinary ones', () => {
    const fanout = new EventFanout();
    const seen: number[] = [];
    fanout.onRaw(() => {
      throw new Error('journal failed');
    });
    fanout.on((event) => seen.push(event.n as number));
    expect(() => fanout.emit({ type: 'message_update', n: 3 })).not.toThrow();
    expect(seen).toEqual([3]);
  });

  test('an unsubscribed raw listener no longer fires', () => {
    const fanout = new EventFanout();
    let calls = 0;
    const off = fanout.onRaw(() => calls++);
    fanout.emit({ type: 'message_update' });
    off();
    fanout.emit({ type: 'message_update' });
    expect(calls).toBe(1);
  });
});
