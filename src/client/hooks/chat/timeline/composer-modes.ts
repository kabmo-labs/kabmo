/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's mode surface, in one hook.
 *
 * Plan/Goal state and the plan-review surface are two halves of the same
 * conversation: a mode command can produce a proposal, and answering that
 * proposal is itself a mode command. They also share the transport — the
 * `KABMO_*` markers the extension emits — so subscribing twice would mean two
 * listeners parsing the same frames.
 *
 * Combined here rather than inside `useChatTimeline` because that hook is
 * already at the repo's per-file ceiling, and because the pair is a coherent
 * unit: a caller that wants one always wants the other.
 */

import type { ChatTimelineModes } from '@/client/hooks/chat/timeline/modes';
import { useHarnesses } from '@/client/hooks/models/use-harnesses';
import type { PlanReviewState } from '@/client/hooks/chat/timeline/plan-review';
import { useChatTimelineModes } from '@/client/hooks/chat/timeline/modes';
import { usePlanReview } from '@/client/hooks/chat/timeline/plan-review';

export interface ComposerModesHandle {
  modes: ChatTimelineModes;
  planReview: PlanReviewState;
}

export function useComposerModes(sessionId: string | null, harness?: string | null): ComposerModesHandle {
  // The harness's PROBE is what says whether it has a `plan` mode at all: the
  // mode list is the agent's own, and a non-omp agent has no `/kabmo-mode`
  // extension to fall back on.
  const { harnesses } = useHarnesses();
  const probe = harnesses.find((entry) => entry.id === harness)?.probe;
  const modeValues = probe?.capabilities.modeValues;
  // The ladder itself comes from the same probe, so a pending chat — which has
  // no session to ask — still shows the agent's own modes as soon as its harness
  // is picked. `omp-acp` is excluded for the reason `GET /modes` excludes it:
  // its selectors are default/plan, which the dedicated Plan toggle expresses.
  const modeChoices = harness && harness !== 'omp-acp' && probe?.modes.length ? probe.modes : undefined;
  return {
    modes: useChatTimelineModes(sessionId, {
      harness,
      ...(modeValues ? { modeValues } : {}),
      ...(modeChoices ? { modeChoices } : {}),
      ...(modeChoices && probe?.currentMode ? { modeCurrent: probe.currentMode } : {}),
    }),
    planReview: usePlanReview(sessionId),
  };
}
