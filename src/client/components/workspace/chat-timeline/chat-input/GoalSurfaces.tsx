/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's two goal surfaces, in one place: the strip above the input and
 * the modal behind it.
 *
 * Both read the same `modes` slice and both are gated on `goalOpen` — a goal
 * the chat still owns, which is NOT omp's `enabled` flag (pausing clears that
 * while the record stays resumable). Keeping the gate in one file is what stops
 * the strip and the modal from disagreeing about whether this chat has a goal.
 *
 * Split out of `ChatInput` for the repo's per-file ceiling, not for reuse: the
 * modal's open state stays in the composer, because the toolbar's Goal button
 * is its other trigger.
 */

import { GoalBanner } from '@/client/components/workspace/chat-timeline/chat-input/GoalBanner';
import { GoalModal } from '@/client/components/workspace/chat-timeline/chat-input/GoalModal';
import type { ComposerModes } from '@/client/components/workspace/chat-timeline/chat-input/modes-props';

export interface GoalSurfacesProps {
  modes?: ComposerModes;
  /** The chat-level run flag (`chatRunning`), for the strip's spinner. */
  running: boolean;
  /** Whether the modal is open, owned by the composer. */
  open: boolean;
  /** Default token budget a new goal starts with (`goalDefaultBudget`). */
  defaultBudget?: number | null;
  onOpen: () => void;
  onClose: () => void;
}

export function GoalSurfaces({ modes, running, open, defaultBudget, onOpen, onClose }: GoalSurfacesProps) {
  if (!modes) return null;

  return (
    <>
      {modes.goalOpen && modes.goalRecord && (
        <GoalBanner
          record={modes.goalRecord}
          running={running}
          continuation={modes.goalContinuation}
          evaluating={modes.goalEvaluating}
          pending={modes.pending}
          onAction={modes.onGoalAction}
          onOpenDetails={onOpen}
        />
      )}

      <GoalModal
        open={open}
        // Manage view whenever a goal the chat still owns exists — the create
        // form would otherwise offer to start a second goal over a PAUSED one,
        // with Resume/Drop/budget unreachable.
        goal={modes.goalOpen}
        goalRecord={modes.goalRecord}
        defaultBudget={defaultBudget}
        pending={modes.pending}
        onClose={onClose}
        onSubmit={modes.onGoalAction}
      />
    </>
  );
}
