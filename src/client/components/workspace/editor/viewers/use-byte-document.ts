/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The loading/error state every byte-drawing viewer shares.
 *
 * Extracted because the failure it prevents is identical across all of them and
 * silent when missed: a viewer that swallows a parse error shows an empty pane,
 * which reads as "this file is empty" rather than "this file could not be
 * read". Each viewer therefore reports the parser's own sentence through
 * `error`, and the caller draws it the same way everywhere.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { ByteSource } from '@/client/components/workspace/editor/viewers/bytes';

export interface ByteLoadState<T> {
  /** The parsed value, or null while loading or after a failure. */
  value: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Load a byte source once and run `parse` over the bytes.
 *
 * The effect keys on `source.id` and `revision` ONLY — never on `source` or
 * `parse`, both of which are fresh objects/closures on every render. Depending
 * on either would re-fetch and re-parse the document on every keystroke
 * elsewhere in the app. The live values are read through refs, so the chain
 * always sees the current source and parser while the effect itself stays put.
 *
 * `revision` is the caller's lever to force a re-read (a workspace refresh).
 */
export function useByteDocument<T>(
  source: ByteSource,
  parse: (bytes: ArrayBuffer) => Promise<T>,
  revision = 0,
): ByteLoadState<T> {
  const [state, setState] = useState<ByteLoadState<T>>({ value: null, loading: true, error: null });

  const sourceRef = useRef(source);
  sourceRef.current = source;
  const parseRef = useRef(parse);
  parseRef.current = parse;

  useEffect(() => {
    const load = sourceRef.current.loadBytes;
    if (!load) {
      setState({ value: null, loading: false, error: 'This file cannot be read from here.' });
      return;
    }
    let cancelled = false;
    setState({ value: null, loading: true, error: null });
    void load()
      .then((bytes) => parseRef.current(bytes))
      .then((value) => {
        if (!cancelled) setState({ value, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Could not read this file.';
        setState({ value: null, loading: false, error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [source.id, revision]);

  return state;
}
