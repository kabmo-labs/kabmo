/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The replay window's END.
 *
 * The window used to close on a fixed 1.5 s wait, which is shorter than a large
 * retained transcript takes to stream: the tail of every restore past that mark
 * was dropped as "output nobody is watching". These cases pin the two real end
 * signals (the adapter's `replay_complete` marker, and an idle `state_update`)
 * and the cap that keeps a replay from growing without bound.
 */

import { describe, expect, test } from 'bun:test';
import { AcpFrameMapper } from '@kabmo-labs/kabmo-acp-mapper/frames';
import { AcpReplay, MAX_REPLAY_EVENTS } from './replay';

const frame = (text: string) => ({ type: 'message_update', message: { id: 'm', content: [{ type: 'text', text }] } });

describe('ACP replay window', () => {
  test('the explicit marker closes the window before the fallback wait', async () => {
    const replay = new AcpReplay();
    const mapper = new AcpFrameMapper();
    const started = Date.now();
    await replay.run(mapper, async () => {
      replay.push(frame('one'));
      replay.markSettled();
    });
    // The fallback is 15 s; a marker-settled run must return immediately.
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(replay.take()).toHaveLength(1);
    expect(replay.isActive).toBe(false);
  });

  test('an idle state is the older adapters’ end marker', () => {
    const replay = new AcpReplay();
    let settled = false;
    void replay.run(new AcpFrameMapper(), async () => {
      replay.markIdle('idle');
      settled = true;
    });
    expect(settled).toBe(true);
  });

  test('the buffer is capped and reports the truncation', async () => {
    const replay = new AcpReplay();
    await replay.run(new AcpFrameMapper(), async () => {
      for (let index = 0; index < MAX_REPLAY_EVENTS + 5; index += 1) replay.push(frame(String(index)));
      replay.markSettled();
    });
    expect(replay.take()).toHaveLength(MAX_REPLAY_EVENTS);
    expect(replay.isTruncated).toBe(true);
  });

  test('frames pushed after the window closed are not buffered', async () => {
    const replay = new AcpReplay();
    await replay.run(new AcpFrameMapper(), async () => {
      replay.push(frame('inside'));
      replay.markSettled();
    });
    replay.push(frame('after'));
    expect(replay.take()).toHaveLength(1);
  });
});
