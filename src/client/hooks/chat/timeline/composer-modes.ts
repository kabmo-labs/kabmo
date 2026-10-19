/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
import type { PlanReviewState } from '@/client/hooks/chat/timeline/plan-review';
import { useChatTimelineModes } from '@/client/hooks/chat/timeline/modes';
import { usePlanReview } from '@/client/hooks/chat/timeline/plan-review';

export interface ComposerModesHandle {
  modes: ChatTimelineModes;
  planReview: PlanReviewState;
}

export function useComposerModes(sessionId: string | null): ComposerModesHandle {
  return { modes: useChatTimelineModes(sessionId), planReview: usePlanReview(sessionId) };
}
