import { useCallback, useEffect, useState } from 'preact/hooks';
import type { UsageResetAccount, UsageResetList, UsageResetSpendResult } from '@/shared/types';

export interface UsageResetsState {
  accounts: UsageResetAccount[];
  /** omp's own reason when the LIST failed — distinct from "no resets". */
  error: string | null;
  isLoading: boolean;
  reload: () => void;
  /** Spend one saved reset; returns omp's sentence either way. */
  spend: (target: string) => Promise<UsageResetSpendResult>;
}

/**
 * Saved rate-limit resets (`GET/POST /api/settings/usage/reset`).
 *
 * A LIST failure keeps its own `error` rather than collapsing into an empty
 * list: omp exits 1 with `No Codex or Claude accounts found…` when there is
 * genuinely nothing, and a failed read renders identically — but only one of
 * the two is worth telling the user about. `spend` is a real provider call, so
 * it returns omp's sentence and never throws: a refusal ("that reset was
 * already redeemed") is an outcome the section renders, not an error.
 */
export function useUsageResets(): UsageResetsState {
  const [accounts, setAccounts] = useState<UsageResetAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(() => {
    setIsLoading(true);
    fetch('/api/settings/usage/reset')
      .then((res) => res.json())
      .then((data: UsageResetList & { error?: string }) => {
        setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
        setError(typeof data.error === 'string' ? data.error : null);
      })
      .catch((err) => {
        setAccounts([]);
        setError(err instanceof Error ? err.message : 'Failed to load saved resets');
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const spend = useCallback(async (target: string): Promise<UsageResetSpendResult> => {
    try {
      const res = await fetch('/api/settings/usage/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      const data = (await res.json()) as UsageResetSpendResult;
      if (data.ok) reload();
      return { ok: Boolean(data.ok), message: data.message || 'No result reported.' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Failed to spend the saved reset' };
    }
  }, [reload]);

  return { accounts, error, isLoading, reload, spend };
}
