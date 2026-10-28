/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the Source Control panel does with an action's answer: show a page the
 * action READ, re-read the tree after a mutation, and report the outcome.
 *
 * Split out of `GitPanel` for the repo's line ceiling, and because the two
 * rules in it are ordering rules rather than rendering:
 *
 *  - **A response is acted on ONCE.** `useFetcher`'s payload is STICKY — it
 *    holds the last response for the life of the mount — while the reload
 *    callback's identity changes whenever the scope does. Switching to a
 *    session in another workspace therefore re-ran the effect against the
 *    PREVIOUS history payload and reopened a modal the user had dismissed,
 *    which is the reported "clicking a session item opens the commit modal".
 *  - **A successful mutation says what it did.** The payload carries `success`
 *    and, when an operation was left stopped on a conflict, WHICH one; the verb
 *    and its operands are recorded at dispatch (`lastAction`) and read back
 *    here, because the answer arrives a render later and the user may have
 *    pressed something else by then. `action-message.ts` owns the wording, and
 *    owns the decision that a stage/unstage/discard stays silent.
 */

import { useEffect, useRef } from 'preact/hooks';
import type { CommitHistoryPage } from '@/shared/types';
import type { GitActionFetcher } from '@/client/hooks/workspace/git-actions';
import { gitActionSuccessMessage } from '@/client/lib/git/action-message';

export interface GitActionOutcomeOptions {
  /** The mutation channel, with the action its payload answers. */
  fetcher: GitActionFetcher;
  /** A read that answered with a page (the history / graph modal). */
  onPage: (page: CommitHistoryPage) => void;
  /** An accepted mutation landed: re-read the working tree. */
  onReload: () => void;
  /** An accepted mutation, in the sentence the user reads. */
  onSuccess: (message: string) => void;
  /** The server's refusal, or a transport failure. */
  onError: (message: string) => void;
}

export function useGitActionOutcome(options: GitActionOutcomeOptions): void {
  const { fetcher, onPage, onReload, onSuccess, onError } = options;
  /** The payload this hook has already acted on. */
  const consumedRef = useRef<unknown>(null);
  // The callbacks are inline arrows at the call site, so they are read through
  // a ref: the effect keys on the RESPONSE, never on a new closure.
  const handlersRef = useRef({ onPage, onReload, onSuccess, onError });
  handlersRef.current = { onPage, onReload, onSuccess, onError };

  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return;
    const payload = fetcher.data;
    if (payload === consumedRef.current) return;
    consumedRef.current = payload;
    const handlers = handlersRef.current;

    if (payload.type === 'history' || payload.type === 'graph') {
      // `hasMore` and `total` are part of the page, not decoration: without
      // them the modal cannot know the branch holds more than the 50 rows it
      // was handed, and the header reports the page size as the total.
      handlers.onPage({
        title: payload.type === 'graph' ? 'Git Graph' : 'Commit History',
        data: payload.data || [],
        hasMore: payload.hasMore,
        total: payload.total,
      });
      return;
    }

    if (!payload.success) {
      handlers.onError(payload.error || 'Git operation failed');
      return;
    }

    handlers.onReload();
    const dispatched = fetcher.lastAction;
    const message = dispatched
      ? gitActionSuccessMessage({ ...dispatched, stopped: payload.stopped })
      : null;
    if (message) handlers.onSuccess(message);
  }, [fetcher.state, fetcher.data, fetcher.lastAction]);
}
