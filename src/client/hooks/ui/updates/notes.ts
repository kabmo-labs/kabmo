/**
 * The About modal's per-target "What's new": the changelog section for the
 * version this install is running.
 *
 * One request per target when its dialog opens — the payload is one release
 * section, which cannot change while the dialog is on screen. The server derives
 * both versions itself, so the only thing this hook sends is WHICH product.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { ActiveReleaseNotes, UpdateTarget } from '@/shared/types/updates';

export interface UseActiveReleaseNotesResult {
  data: ActiveReleaseNotes | null;
  loading: boolean;
  error: string | null;
}

export function useActiveReleaseNotes(target: UpdateTarget | null): UseActiveReleaseNotesResult {
  const [data, setData] = useState<ActiveReleaseNotes | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!target) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(`/api/updates/notes?target=${target}`, { signal: controller.signal });
        const payload = (await response.json()) as ActiveReleaseNotes;
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
  }, [target]);

  return { data, loading, error };
}