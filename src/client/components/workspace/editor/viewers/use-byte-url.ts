/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A URL a browser can load bytes from, for the viewers that take one rather
 * than an `ArrayBuffer` (`<iframe>` for a PDF, `<img>` for an SVG).
 *
 * A workspace file already has one: `/api/fs/raw`. A file the OS handed over
 * (a drop, a PWA launch) has no server-reachable path, so its bytes are read
 * through the live handle and wrapped in an object URL — which is revoked on
 * unmount and whenever the source changes, because an object URL holds its
 * Blob alive until it is revoked and a long session that opened many dropped
 * files would otherwise leak every one of them.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { ByteSource } from '@/client/components/workspace/editor/viewers/bytes';

export interface ByteUrlState {
  url: string | null;
  loading: boolean;
  error: string | null;
}

export function useByteUrl(source: ByteSource, revision = 0): ByteUrlState {
  const [state, setState] = useState<ByteUrlState>({
    url: source.url,
    loading: !source.url,
    error: null,
  });

  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    const current = sourceRef.current;
    if (current.url) {
      setState({ url: current.url, loading: false, error: null });
      return;
    }
    const load = current.loadBytes;
    if (!load) {
      setState({ url: null, loading: false, error: 'This file cannot be read from here.' });
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ url: null, loading: true, error: null });
    void load()
      .then((bytes) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([bytes]));
        setState({ url: objectUrl, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          url: null,
          loading: false,
          error: err instanceof Error ? err.message : 'Could not read this file.',
        });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // `source.id` is the file's identity; see `use-byte-document`.
  }, [source.id, revision]);

  return state;
}
