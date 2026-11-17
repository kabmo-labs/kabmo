/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The handshake orchestration a session runs on `start`.
 *
 * Split from the session class for the repo's file ceiling, and because the
 * replay window is the only reason this is more than one call: an ordinary
 * start is `initialize` + `session/new|load|resume` + the picks, while a
 * restore runs the same handshake with the replay collector open and waits for
 * its idle marker. Keeping both forms here means the class exposes one method
 * and the rules live next to `replay.ts`.
 */

import type { AcpProcess } from '@/server/lib/harness/acp/client';
import type { AcpFrameMapper } from '@/server/lib/harness/acp/frames';
import type { AcpReplay } from '@/server/lib/harness/acp/replay';
import type {
  AcpHandshakeSelections,
  AcpHandshakeTarget,
} from '@/server/lib/harness/acp/session-handshake';
import { handshakeAcpSession } from '@/server/lib/harness/acp/session-handshake';
import type { IdleReaper } from '@/server/lib/omp/rpc/idle-reaper';

/** The session slice a start drives: the handshake target, its clock and id. */
export interface AcpStartTarget extends AcpHandshakeTarget {
  sessionId: string;
  idle: IdleReaper;
}

export async function startAcpSession(
  target: AcpStartTarget,
  proc: AcpProcess,
  mapper: AcpFrameMapper,
  replay: AcpReplay,
  wantsReplay: boolean,
  wanted: AcpHandshakeSelections,
  sessionIdToLoad?: string,
  forkFromSessionId?: string,
  forkMeta?: Record<string, unknown>,
): Promise<{ sessionId: string }> {
  // The id is known BEFORE the handshake on a restore, and `session_info_update`
  // arrives DURING the replay: without it the agent's own title was dropped
  // (the writer keys on `host.sessionId`).
  if (sessionIdToLoad) target.sessionId = sessionIdToLoad;
  const handshake = () => handshakeAcpSession(
    target,
    proc,
    wanted,
    sessionIdToLoad,
    forkFromSessionId,
    forkMeta,
    wantsReplay,
  );
  if (wantsReplay) await replay.run(mapper, handshake);
  else await handshake();
  // A slow handshake is not idleness: the window starts once it is usable.
  target.idle.reset(true);
  return { sessionId: target.sessionId };
}
