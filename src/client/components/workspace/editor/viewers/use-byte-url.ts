/**
 * @license
 * SPDX-License-Identifier: MIT
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
 *
 * A source that already has a URL is PROBED, not trusted. `/api/fs/raw` answers
 * a file past its ceiling with `415` and a JSON body, and an `<iframe>` pointed
 * at that draws the raw JSON (or, for the PDF plugin, a blank frame) instead of
 * the refusal the user needs to read. The probe is a one-byte ranged GET, not a
 * `HEAD`: a HEAD carries no body, so the server's own sentence ("This file is
 * 45.00 MB — larger than the 30.00 MB the editor opens.") would be replaced by
 * a generic "HTTP 415", and that sentence is the whole reason the refusal is
 * worth showing. A byte is all it costs, and the frame still streams the file.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { readRefusalReason, type ByteSource } from '@/client/components/workspace/editor/viewers/bytes';

export interface ByteUrlState {
  url: string | null;
  loading: boolean;
  error: string | null;
}

export function useByteUrl(source: ByteSource, revision = 0): ByteUrlState {
  // A server URL is probed before it is used, so the FIRST render must not hand
  // it to the frame: `loading` starts true for anything that is not a `blob:`
  // URL we made ourselves, or the refusal would flash a blank frame first.
  const needsProbe = Boolean(source.url) && !source.url?.startsWith('blob:');
  const [state, setState] = useState<ByteUrlState>({
    url: needsProbe ? null : source.url,
    loading: needsProbe || !source.url,
    error: null,
  });

  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    const current = sourceRef.current;
    if (current.url) {
      const url = current.url;
      // A `blob:` URL is ours, made from bytes we already hold — nothing to
      // probe. A server URL may refuse, and the refusal has to be READ.
      if (url.startsWith('blob:')) {
        setState({ url, loading: false, error: null });
        return;
      }
      let cancelled = false;
      setState({ url: null, loading: true, error: null });
      void fetch(url, { headers: { Range: 'bytes=0-0' } })
        .then(async (res) => {
          if (cancelled) return;
          if (res.ok) {
            setState({ url, loading: false, error: null });
            return;
          }
          setState({ url: null, loading: false, error: await readRefusalReason(res) });
        })
        .catch(() => {
          // A failed probe says nothing about the file (a dropped request, an
          // offline tab), so the URL is used rather than reported as a refusal.
          if (!cancelled) setState({ url, loading: false, error: null });
        });
      return () => {
        cancelled = true;
      };
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
        // The Blob carries the source's MIME type because a `blob:` URL serves
        // its own `Content-Type`, and an empty one is not the same as an absent
        // one: Chrome's PDF plugin refuses to initialize without
        // `application/pdf` and the frame stays blank. A source with no type
        // (an inline attachment, an extensionless file) keeps the empty Blob —
        // there is nothing honest to label it.
        objectUrl = URL.createObjectURL(
          current.mimeType ? new Blob([bytes], { type: current.mimeType }) : new Blob([bytes]),
        );
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
