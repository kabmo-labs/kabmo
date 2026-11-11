/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ACP mode a chat with NO session can still choose.
 *
 * A pending `new-…` chat has no child to command, so the composer's mode
 * control used to be empty until the first prompt spawned — picking a harness
 * from the dropdown changed the model list but left the mode surface on the
 * previous agent's (or on nothing at all). The harness PROBE already publishes
 * the agent's ladder, so the control can be drawn and the pick recorded before
 * the spawn exists; the pick then rides the spawn exactly as the model and
 * harness picks do (`SpawnOptions.sessionMode`).
 *
 * Split from `modes.ts` for the repo's per-file ceiling, and the seam is real:
 * this is the only state that exists BEFORE a session does.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { isPendingSessionId } from '@/shared/lib/omp/session/default-title';
import { pendingSessionMode, type SessionModeState } from '@/shared/lib/harness/session-modes';
import type { ModeCapabilities } from '@/client/hooks/chat/timeline/mode-availability';

export interface PendingSessionMode {
  /** The selector to draw, or null when the agent publishes no ladder. */
  mode: SessionModeState | null;
  /** Record a pick. There is no child to command, so it is held for the spawn. */
  select: (value: string) => void;
  /** The value the spawn must request, read by the send path. */
  spawnRef: { current: string | null };
}

export function usePendingSessionMode(
  sessionId: string | null,
  capabilities: ModeCapabilities,
): PendingSessionMode {
  const [picked, setPicked] = useState<string | null>(null);
  const spawnRef = useRef<string | null>(null);
  const ladder = capabilities.modeChoices;
  // The value the spawn must request: the operator's pick, but only while the
  // CURRENT agent still offers it. Derived at render (the same pattern the mode
  // toggles use for their own mirrors) so the ref can never hold a value this
  // agent does not take, not even for the render before an effect would clear it.
  const offered = picked && ladder?.some((choice) => choice.value === picked) ? picked : null;
  spawnRef.current = isPendingSessionId(sessionId) ? offered : null;
  // A different agent's ladder is a different choice: a pick made on one is not
  // a pick on the other. Keyed by the chat too, so a pick does not follow the
  // user to another pending chat.
  const ladderKey = `${sessionId ?? ''}\u0000${(ladder ?? []).map((choice) => choice.value).join(',')}`;
  useEffect(() => {
    setPicked(null);
  }, [ladderKey]);

  const select = useCallback((value: string) => {
    setPicked(value);
  }, []);

  const mode = isPendingSessionId(sessionId)
    ? pendingSessionMode(
        ladder && ladder.length > 0
          ? { choices: ladder, ...(capabilities.modeCurrent ? { current: capabilities.modeCurrent } : {}) }
          : undefined,
        offered,
      )
    : null;
  return { mode, select, spawnRef };
}
