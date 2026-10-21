/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The composer's model/thinking refs, and the one rule that ties them to a
 * session.
 *
 * Three of the four are mirrors of picks the user made, and they exist because
 * the send path cannot read render state: it is created once per deps record,
 * so a pick read from a prop there would dispatch with whatever it was when
 * that closure was built. The fourth (`deferredComposerPickRef`) holds a pick
 * made WHILE a turn streams, so it cannot re-target the answer in flight.
 *
 * Split out of `timeline/index.ts` for the per-file ceiling; the semantics are
 * the hook's own and are documented at each field.
 */

import { useEffect, useRef } from 'preact/hooks';
import type { ComposerModelPick } from '@/client/hooks/chat/timeline/deferred-model';

export interface ComposerRefs {
  /** Model picked on a pending `new-…` chat; applied to the spawn. */
  pendingComposerModelRef: { current: { provider: string; modelId: string } | null };
  /** Same, for the thinking level. */
  pendingThinkingLevelRef: { current: string | null };
  /** Live mirror of the composer's pick; snapshotted onto queued items. */
  composerModelRef: { current: { provider: string; modelId: string; thinkingLevel: string } | null };
  /** A pick made mid-run, pushed right before the next prompt this composer starts. */
  deferredComposerPickRef: { current: ComposerModelPick | null };
}

export function useComposerRefs(sessionId: string | null): ComposerRefs {
  const pendingComposerModelRef = useRef<{ provider: string; modelId: string } | null>(null);
  const pendingThinkingLevelRef = useRef<string | null>(null);
  const composerModelRef = useRef<{ provider: string; modelId: string; thinkingLevel: string } | null>(null);
  const deferredComposerPickRef = useRef<ComposerModelPick | null>(null);

  // A stashed pick belongs to ONE session's next prompt: carrying it across a
  // switch would silently re-target the session the user just opened.
  useEffect(() => {
    deferredComposerPickRef.current = null;
  }, [sessionId]);

  return { pendingComposerModelRef, pendingThinkingLevelRef, composerModelRef, deferredComposerPickRef };
}
