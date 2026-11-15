/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `+`/`−` line counts of one run's changed files.
 *
 * The chat's run summary prints a per-file and a total stat, so it needs counts
 * without opening a diff. The server computes them from the same net pair the
 * diff tab reads (first `before`, last `after`), so the number and the diff can
 * never disagree.
 *
 * Read once per run summary the reader actually has on screen — the timeline
 * mounts a window of rows, so a long session does not fetch every run's stats
 * at once. A failed read leaves the counts absent; the file list itself still
 * renders, and a made-up `0` would be a lie about the run.
 */

import { useEffect, useState } from 'preact/hooks';
import type { SessionChangeCounts } from '@/shared/types';

/** Absolute path → the run's net counts for that path. */
export type ChangeStatsByPath = Record<string, SessionChangeCounts>;

export function useChangeStats(
  sessionId: string | null,
  from: number,
  to: number,
): ChangeStatsByPath {
  const [stats, setStats] = useState<ChangeStatsByPath>({});

  useEffect(() => {
    if (!sessionId) {
      setStats({});
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams({ from: String(from), to: String(to) });
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/changes/stats?${params.toString()}`,
        );
        const data = (await res.json().catch(() => null)) as { files?: ChangeStatsByPath } | null;
        if (!cancelled && data?.files) setStats(data.files);
      } catch {
        // Counts are an annotation; the list stays truthful without them.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, from, to]);

  return stats;
}
