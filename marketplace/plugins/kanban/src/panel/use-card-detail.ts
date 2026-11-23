/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One card's detail, read on demand.
 *
 * The board's snapshot is deliberately slim (no prompt, no images), so opening a
 * card is its own read. That keeps a 500-card board cheap and still gives the
 * sheet everything it needs — including the stage the card belongs to and the
 * agent that stage resolves to.
 */

import { useCallback, useState } from 'preact/hooks';
import { useRpc } from '@kabmo-labs/kabmo-ui';

import type { Card, ResolvedAgent, Stage } from '../protocol';

/** What `readCard` answers. */
export interface CardDetailAnswer {
  card: Card;
  board: { stages: Stage[]; defaults: Record<string, unknown> };
  stage: Stage | null;
  agent: ResolvedAgent;
}

/** The card on screen, and the read that fetched it. */
export function useCardDetail(): {
  card: Card | null;
  agent: ResolvedAgent | null;
  error: string | null;
  load: (id: string) => Promise<void>;
  clear: () => void;
} {
  const rpc = useRpc<{ id: string }, CardDetailAnswer>('readCard');
  const [card, setCard] = useState<Card | null>(null);
  const [agent, setAgent] = useState<ResolvedAgent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (id: string) => {
      const outcome = await rpc.call({ id });
      if (outcome.ok) {
        const answer = outcome.value as CardDetailAnswer;
        setCard(answer.card);
        setAgent(answer.agent);
        setError(null);
      } else {
        // The card vanished under us (an agent deleted it): say so and close.
        setCard(null);
        setAgent(null);
        setError(outcome.error.message);
      }
    },
    [rpc],
  );

  return {
    card,
    agent,
    error,
    load,
    clear: () => {
      setCard(null);
      setAgent(null);
      setError(null);
    },
  };
}
