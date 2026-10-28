/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `btw:<id>` topic: one session's side-question frames.
 *
 * Bound to the BTW registry while anyone is watching, so the panel follows a
 * side turn without a socket of its own. The snapshot is the same `btw_state`
 * the panel used to receive as its stream's first frame.
 */

import { btwTopic } from '@/shared/lib/realtime/protocol';
import { getRealtimeHub, type TopicDescriptor } from '@/server/lib/realtime/hub.server';
import { btwStateFor, subscribeBtw } from '@/server/lib/btw/registry.server';

export function btwDescriptor(sessionId: string): TopicDescriptor {
  return {
    resolve: () => btwStateFor(sessionId),
    attach: () => subscribeBtw(sessionId, (frame) => {
      getRealtimeHub().publish(btwTopic(sessionId), frame);
    }),
  };
}
