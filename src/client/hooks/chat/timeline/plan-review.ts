/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The plan a model submitted for review.
 *
 * Plan mode's approval path is a `write` to `xd://propose`, which Kabmo's
 * extension intercepts and parks — the model's tool call stays open until an
 * answer arrives. The proposal therefore reaches the client as a
 * `KABMO_PLAN_PROPOSAL` marker carrying the plan body, and the client's answer
 * travels back as a second mode command. Nothing polls: both directions ride the
 * stream the transcript already uses.
 *
 * A proposal marked `deciding` is deliberately kept on screen until the child
 * confirms or refuses, because a decision that silently failed would leave the
 * operator looking at a blank panel while the agent stayed parked.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { PlanProposal } from '@/shared/lib/omp/mode/types';
import { KABMO_MODE_SIGNAL } from '@/shared/lib/omp/mode/client-signal';
import { subscribeClientSignal } from '@/client/lib/signals';
import type { ParsedMarker } from '@/shared/lib/omp/mode/markers';
import { isPendingSessionId } from '@/shared/lib/omp/session/default-title';
import { isModeMarker } from '@/shared/lib/omp/mode/constants';

export interface PlanReviewState {
  proposal: PlanProposal | null;
  /** A decision is in flight; the panel disables its actions. */
  deciding: boolean;
  error: string | null;
  decide: (choice: string, feedback: string) => Promise<void>;
  dismiss: () => void;
}

export function proposalFromMarkerPayload(payload: Record<string, unknown>): PlanProposal | null {
  const title = payload.title;
  const planFilePath = payload.planFilePath;
  if (typeof title !== 'string' || typeof planFilePath !== 'string') return null;
  const planContent = typeof payload.planContent === 'string' ? payload.planContent : '';
  return { title, planFilePath, planContent };
}

export function usePlanReview(sessionId: string | null): PlanReviewState {
  const [proposal, setProposal] = useState<PlanProposal | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;

  // A proposal belongs to the process that raised it. Carrying it into another
  // session would offer a decision the new child never asked for.
  useEffect(() => {
    setProposal(null);
    setError(null);
    setDeciding(false);
  }, [sessionId]);

  // A parked proposal is invisible to a client that was not attached when it
  // was announced: the marker went out over the stream, omp never re-delivers
  // it, and the plan body exists only in the extension's slot. So ask the child
  // to re-send it — but ONLY while a child is already alive. This route is the
  // Kabmo's lazy-spawn path, and opening a finished session to READ it must
  // not boot an omp process for a question the answer to which is "nothing is
  // parked" (the same rule the observer-only commands follow).
  useEffect(() => {
    const current = sessionId;
    if (!current || isPendingSessionId(current)) return;
    let cancelled = false;
    fetch(`/api/agent/${encodeURIComponent(current)}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ running?: boolean }>) : null))
      .then((data) => {
        if (cancelled || !data?.running) return;
        return fetch(`/api/agent/${encodeURIComponent(current)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'kabmo_mode', scope: 'plan', action: 'republish' }),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => subscribeClientSignal(KABMO_MODE_SIGNAL, (detail) => {
      const marker = detail?.marker as ParsedMarker | undefined;
      if (!marker) return;
      if (sessionId && detail.sessionId && detail.sessionId !== sessionId) return;
      if (isModeMarker(marker.marker, 'planProposalMarker')) {
        const next = proposalFromMarkerPayload(marker.payload);
        if (next) {
          setProposal(next);
          setError(null);
        }
        return;
      }
      // A decision reported by the child: the parked promise is resolved, so
      // the review surface has done its job.
      if (isModeMarker(marker.marker, 'planDecisionMarker')) {
        setProposal(null);
        setDeciding(false);
        return;
      }
      if (isModeMarker(marker.marker, 'planSavedMarker')) {
        setProposal(null);
        setDeciding(false);
        return;
      }
      if (isModeMarker(marker.marker, 'modeErrorMarker')) {
        setDeciding(false);
        setError(typeof marker.payload.reason === 'string' ? marker.payload.reason : 'Mode command failed');
      }
  }), [sessionId]);

  const decide = useCallback(async (choice: string, feedback: string) => {
    const current = sessionRef.current;
    if (!current) return;
    setDeciding(true);
    setError(null);
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(current)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'kabmo_mode',
          scope: 'plan',
          action: 'decide',
          payload: { choice, feedback },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'The plan decision could not be sent.');
        setDeciding(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The plan decision could not be sent.');
      setDeciding(false);
    }
  }, []);

  const dismiss = useCallback(() => setProposal(null), []);

  return { proposal, deciding, error, decide, dismiss };
}
