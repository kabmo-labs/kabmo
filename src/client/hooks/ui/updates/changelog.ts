/**
 * The release range behind the update popup.
 *
 * Fetched only when the popup has decided to open — the check that already ran
 * said an update exists, and a normal boot must not pay for a GitHub read it
 * will not use. One request per mount, kept for the life of the popup; the
 * payload is a range of released versions, which cannot change while the dialog
 * is on screen.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { UpdateChangelog } from '@kabmo-labs/kabmo-app-contracts/updates';

export interface UseUpdateChangelogResult {
  data: UpdateChangelog | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useUpdateChangelog(enabled: boolean): UseUpdateChangelogResult {
  const [data, setData] = useState<UpdateChangelog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetch('/api/updates/changelog', { signal: controller.signal });
        const payload = (await response.json()) as UpdateChangelog;
        if (!response.ok) throw new Error(`Could not load release notes (HTTP ${response.status})`);
        setData(payload);
        setError(payload.error);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Could not load release notes');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [enabled, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { data, loading, error, reload };
}
