/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The SOURCE transcript of the fork being composed.
 *
 * A fork chat is empty until the first send, so the operator had no sight of
 * the history the first turn continues — and after switching "Fork from" the
 * old preview stayed. This reads the source session and slices it the way the
 * server will cut the branch (`forkPreviewMessages`), refetching when the
 * source changes.
 *
 * `limit=all` on purpose: the default 120-row window would cut the preview at
 * a different row than the branch file, and a fork of a long session usually
 * anchors further back than that window covers.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ChatMessageData } from '@/shared/types';
import { forkPreviewMessages } from '@/shared/lib/chat/timeline/fork-preview';

export interface ForkPreview {
  /** The rows the fork will carry, in source order; empty while loading. */
  messages: ChatMessageData[];
  loading: boolean;
  /** Why the source transcript could not be read, or null. */
  error: string | null;
}

interface LoadedSource {
  id: string;
  messages: ChatMessageData[];
}

const EMPTY: ChatMessageData[] = [];

export function useForkPreview(
  sourceSessionId: string | null,
  anchorEntryId: string | null,
): ForkPreview {
  const [loaded, setLoaded] = useState<LoadedSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    if (!sourceSessionId) {
      setLoaded(null);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    let live = true;
    setLoading(true);
    setError(null);
    fetch(`/api/chat/${encodeURIComponent(sourceSessionId)}?limit=all`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          | { session?: { messages?: ChatMessageData[] }; error?: string }
          | null;
        if (!live) return;
        if (!response.ok) {
          setError({ id: sourceSessionId, message: body?.error ?? `HTTP ${response.status}` });
          setLoaded(null);
          return;
        }
        setLoaded({ id: sourceSessionId, messages: body?.session?.messages ?? [] });
      })
      .catch((err: unknown) => {
        if (!live || controller.signal.aborted) return;
        setError({
          id: sourceSessionId,
          message: err instanceof Error ? err.message : 'Could not load the source transcript',
        });
        setLoaded(null);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [sourceSessionId]);

  // Rows from a previous source are not this fork's history: they disappear
  // the moment the picker moves, rather than standing in for the new source.
  const messages = useMemo(
    () => (loaded && loaded.id === sourceSessionId
      ? forkPreviewMessages(loaded.messages, anchorEntryId)
      : EMPTY),
    [loaded, sourceSessionId, anchorEntryId],
  );

  return {
    messages,
    loading,
    error: error && error.id === sourceSessionId ? error.message : null,
  };
}
