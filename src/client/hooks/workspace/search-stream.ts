import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { SearchResultItem } from '@/shared/types/fs';
import { readSseStream } from '@/shared/lib/chat/read-sse';

interface SearchStreamState {
  results: SearchResultItem[];
  isSearching: boolean;
  /** The run stopped at the server's cap; `results` is not the whole answer. */
  truncated: boolean;
  /**
   * rg's own refusal — a regex it cannot compile, a pattern it read as a flag.
   *
   * It used to be dropped, so a run that exited 2 rendered as "No results
   * found.": the user typed `useFoo(` with Regex on, rg answered `regex parse
   * error: unclosed group`, and the panel reported the workspace as empty.
   */
  error: string | null;
}

/**
 * Streams `/api/fs/search` SSE results into state as they arrive, so the
 * panel paints file groups while ripgrep is still walking the tree instead
 * of waiting for the full run to finish.
 *
 * The POST body goes out as `application/x-www-form-urlencoded` (the same
 * encoding the old `useFetcher.submit` used) and the response is consumed
 * incrementally via the shared SSE reader. A new `start` call aborts the
 * previous run — matching the fetcher semantics the panel relied on.
 *
 * Results carry the `scope` they were searched under (the workspace root plus
 * the selected repo). A workspace switch therefore shows no hits at all rather
 * than the previous workspace's — a match's path is relative to the root it was
 * found under, so the same string names a different file, or none, here.
 */
export function useSearchStream(scope: string): SearchStreamState & {
  start: (body: Record<string, string>) => Promise<void>;
} {
  const [state, setState] = useState<{ scope: string; results: SearchResultItem[]; truncated: boolean; error: string | null }>({ scope, results: [], truncated: false, error: null });
  const [isSearching, setIsSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const start = useCallback(async (body: Record<string, string>) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requested = scopeRef.current;

    setState({ scope: requested, results: [], truncated: false, error: null });
    setIsSearching(true);
    try {
      const response = await fetch('/api/fs/search', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body),
        signal: controller.signal,
      });

      await readSseStream(
        response,
        (event, data) => {
          // A run superseded by a workspace switch is no longer this panel's.
          if (scopeRef.current !== requested) return;
          if (event === 'done') {
            // The server reports whether it stopped at its cap. It travels on
            // `done` rather than as a separate frame so a client that missed it
            // cannot leave the notice up from a previous run.
            let truncated = false;
            try {
              truncated = JSON.parse(data)?.truncated === true;
            } catch {
              // A malformed summary leaves the flag off; the results are still shown.
            }
            setState(prev => (prev.scope === requested ? { ...prev, truncated } : prev));
            return;
          }
          if (event === 'error') {
            // rg's own message, surfaced verbatim: it names the offending
            // character and the reason, which is the only thing that tells a
            // failed regex apart from a workspace with no hits.
            let message = 'Search failed';
            try {
              message = JSON.parse(data)?.error || message;
            } catch {
              // A malformed frame keeps the generic wording.
            }
            setState(prev => (prev.scope === requested ? { ...prev, error: message } : prev));
            return;
          }
          if (event !== 'matches') return;
          try {
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) {
              setState(prev => prev.scope === requested
                ? { ...prev, results: [...prev.results, ...parsed] }
                : prev);
            }
          } catch {
            // Malformed frame — skip; the next frame carries its own payload.
          }
        },
        controller.signal,
      );
    } catch {
      // Aborted (superseded or unmounted) — leave partial results rendered.
    } finally {
      if (aliveRef.current && abortRef.current === controller) {
        abortRef.current = null;
        setIsSearching(false);
      }
    }
  }, []);

  return {
    results: state.scope === scope ? state.results : [],
    // A run in flight for another scope is not searching THIS one.
    isSearching: isSearching && state.scope === scope,
    truncated: state.scope === scope && state.truncated,
    error: state.scope === scope ? state.error : null,
    start,
  };
}
