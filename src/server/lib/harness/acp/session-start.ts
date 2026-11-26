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

import type { AcpProcess } from '@kabmo-labs/kabmo-acp-client/client';
import type { AcpFrameMapper } from '@kabmo-labs/kabmo-acp-mapper/frames';
import type { AcpReplay } from '@/server/lib/harness/acp/replay';
import type {
  AcpHandshakeSelections,
  AcpHandshakeTarget,
} from '@/server/lib/harness/acp/session-handshake';
import { handshakeAcpSession } from '@/server/lib/harness/acp/session-handshake';
import { loadAcpGrants } from '@/server/lib/harness/acp/grants.server';
import type { IdleReaper } from '@kabmo-labs/kabmo-idle-reaper';

/** The session slice a start drives: the handshake target, its clock and id. */
export interface AcpStartTarget extends AcpHandshakeTarget {
  sessionId: string;
  idle: IdleReaper;
  /** The approval queue, so the grants earned in an earlier process are
   *  hydrated before the first `session/request_permission` can arrive. */
  permissions?: { grants: { hydrate(keys: readonly string[]): void } };
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
  // "Always allow" is the operator's standing decision for this chat; a new
  // child must not ask again. Read once, before the session can take a prompt.
  target.permissions?.grants.hydrate(await loadAcpGrants(target.sessionId));
  // A slow handshake is not idleness: the window starts once it is usable.
  target.idle.reset(true);
  return { sessionId: target.sessionId };
}
