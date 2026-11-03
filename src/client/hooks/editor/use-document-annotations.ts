/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One document's annotations, loaded and written.
 *
 * The hook owns the three states the review surface must distinguish, because
 * collapsing them is how a failed read looks like "no annotations yet":
 *
 * - `loading` — a read is in flight;
 * - `error` — the read failed, and the message is shown as-is;
 * - an empty list — the read SUCCEEDED and there is nothing stored.
 *
 * A write optimistically replaces the row for its block and rolls back to the
 * previous list when the server refuses, so the mark on screen never disagrees
 * with what is stored. The tradeoff is deliberate: an optimistic write is what
 * makes a click feel instant, and the rollback is the half that keeps it honest.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import { fetchAnnotations, removeAnnotation, saveAnnotation } from '@/client/lib/review/client';
import type { BlockVerdict, DocumentAnnotation, ReviewTarget } from '@/shared/lib/markdown/blocks/types';

export interface UseDocumentAnnotationsResult {
  annotations: DocumentAnnotation[];
  loading: boolean;
  /** The read's or a write's failure, shown verbatim. */
  error: string | null;
  /** Store a judgement for one block. Resolves whether or not the write landed. */
  save: (input: { blockKey: string; lineStart: number; lineEnd: number; verdict: BlockVerdict; note: string; quote: string }) => Promise<void>;
  /** Remove one judgement by its stored id. */
  remove: (id: string) => Promise<void>;
  /** Re-read after a failure. */
  reload: () => void;
}

export function useDocumentAnnotations(target: ReviewTarget | null, enabled: boolean): UseDocumentAnnotationsResult {
  const [annotations, setAnnotations] = useState<DocumentAnnotation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const path = target?.path ?? null;
  const root = target?.root ?? null;
  const repo = target?.repo ?? null;

  useEffect(() => {
    if (!enabled || !path) {
      setAnnotations([]);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchAnnotations({ path, root, repo }, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return;
        setAnnotations(rows);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Could not read annotations');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // The primitives, never the object: a caller builds `target` inline.
  }, [enabled, path, root, repo, revision]);

  // The latest list, so a rollback restores what was there — not what the
  // render that created this closure saw.
  const latest = useRef(annotations);
  latest.current = annotations;

  const save = useCallback<UseDocumentAnnotationsResult['save']>(
    async (input) => {
      if (!path) return;
      const previous = latest.current;
      const optimistic: DocumentAnnotation = {
        id: `pending:${input.blockKey}`,
        scope: '',
        path,
        blockKey: input.blockKey,
        lineStart: input.lineStart,
        lineEnd: input.lineEnd,
        verdict: input.verdict,
        note: input.note,
        quote: input.quote,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setAnnotations([...previous.filter((row) => row.blockKey !== input.blockKey), optimistic]);
      setError(null);
      try {
        const stored = await saveAnnotation({ path, root, repo }, input);
        setAnnotations((current) => current.map((row) => (row.blockKey === input.blockKey ? stored : row)));
      } catch (cause) {
        setAnnotations(previous);
        setError(cause instanceof Error ? cause.message : 'Could not save the annotation');
      }
    },
    [path, root, repo],
  );

  const remove = useCallback<UseDocumentAnnotationsResult['remove']>(async (id) => {
    const previous = latest.current;
    setAnnotations(previous.filter((row) => row.id !== id));
    setError(null);
    try {
      await removeAnnotation(id);
    } catch (cause) {
      setAnnotations(previous);
      setError(cause instanceof Error ? cause.message : 'Could not remove the annotation');
    }
  }, []);

  return { annotations, loading, error, save, remove, reload: () => setRevision((value) => value + 1) };
}
