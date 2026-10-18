/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The settings sidebar's "Reload OMP" action.
 *
 * A reload here means RECYCLE, not re-read: the server disposes every standby
 * omp process — the pooled utility children that answer the provider and model
 * lists and the composer's `/` popup, plus the prewarmed session hosts — so the
 * next command boots the binary currently installed. That is the only way to
 * pick up an `omp update` without restarting the chamber: a live omp child is
 * the build it was spawned from for its whole life.
 *
 * Live sessions are deliberately untouched (the server owns that decision), so
 * this is safe to press at any time — a chat mid-turn keeps streaming.
 *
 * The client caches that mirror those lists are dropped on success, because a
 * recycled server behind a 5-minute client cache would still show the old
 * commands in the `/` popup.
 */

import { useCallback, useState } from 'preact/hooks';
import { invalidateComposerCache } from '@/shared/lib/chat/composer/client';
import { notifyModelsUpdated } from '@/shared/lib/models/client';

/** What one reload did, in the words the caller's toast needs. */
export interface ReloadEngineOutcome {
  ok: boolean;
  message: string;
}

export interface UseReloadOmpEngineResult {
  isReloading: boolean;
  reload: () => Promise<ReloadEngineOutcome>;
}

export function useReloadOmpEngine(): UseReloadOmpEngineResult {
  const [isReloading, setIsReloading] = useState(false);

  const reload = useCallback(async (): Promise<ReloadEngineOutcome> => {
    setIsReloading(true);
    try {
      const response = await fetch('/api/omp/reload-engine', { method: 'POST' });
      const payload = (await response.json().catch(() => null)) as
        | { success?: boolean; utility?: number; prewarmed?: number; error?: string }
        | null;
      if (!response.ok || !payload?.success) {
        return { ok: false, message: payload?.error ?? `Reload failed (HTTP ${response.status})` };
      }

      // The lists these caches hold were built from the processes just disposed.
      invalidateComposerCache();
      notifyModelsUpdated();

      const utility = payload.utility ?? 0;
      const prewarmed = payload.prewarmed ?? 0;
      // A pool with nothing live in it is a normal state, not a failure: the
      // next command spawns the current binary either way. Saying so avoids a
      // "reloaded 0 processes" line that reads like the button did nothing.
      const message = utility + prewarmed === 0
        ? 'No standby omp processes were running — the next command starts the current build.'
        : `Reloaded omp engine — ${utility} utility, ${prewarmed} prewarmed process${utility + prewarmed === 1 ? '' : 'es'} recycled.`;
      return { ok: true, message };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Failed to reload the omp engine.' };
    } finally {
      setIsReloading(false);
    }
  }, []);

  return { isReloading, reload };
}
