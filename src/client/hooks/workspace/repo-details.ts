/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The repository rows for the repo management modal: one read per repo, and the
 * two things that make it usable while the answer is still arriving.
 *
 * **The last good read is kept while a new one is in flight.** A refresh (or a
 * discovery walk finishing and adding repositories) would otherwise blank the
 * list to a spinner and make the dialog flash on every re-read; the rows a
 * reader is looking at stay put and are replaced when the new answer lands.
 *
 * **The read re-runs when discovery finishes.** `repos` comes from the shared
 * store, which reports `scanning: true` while the server's background walk is
 * running — a modal opened during one would otherwise list the root alone and
 * look finished. The dependency on `scanning` is what re-reads the moment the
 * walk reports done, so the list fills in without a second click.
 *
 * The read is deliberately NOT on a realtime topic: it costs a `git` spawn per
 * repository, and a topic would pay that on every publish the server makes.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { GitRepoDetail } from '@/shared/types/git';

export interface RepoDetailsHandle {
  /** Rows from the last successful read; `[]` before the first one lands. */
  details: GitRepoDetail[];
  /** A read is in flight and no rows have arrived yet. */
  loading: boolean;
  /** A read is in flight, whether or not rows are on screen. */
  reading: boolean;
  error: string | null;
  /** Re-read now (the modal's Refresh). */
  refresh: () => void;
}

interface RepoDetailsPayload {
  success?: boolean;
  details?: GitRepoDetail[];
  error?: string;
}

export function useRepoDetails(options: {
  /** Nothing is fetched while false — a closed dialog costs nothing. */
  open: boolean;
  rootPath?: string;
  /** The discovered repos, from the shared store. */
  repos: readonly string[];
  /** Discovery is still running server-side; a flip re-reads the list. */
  scanning: boolean;
}): RepoDetailsHandle {
  const { open, rootPath, scanning } = options;
  const [details, setDetails] = useState<GitRepoDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // A list identity that changes when the DISCOVERED SET does, not on every
  // render: `repos` is a fresh array from the store's snapshot on each call.
  const reposKey = options.repos.join('\u0000');

  const aliveRef = useRef(true);
  const inFlightRef = useRef<AbortController | null>(null);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      inFlightRef.current?.abort();
      inFlightRef.current = null;
    };
  }, []);

  const read = useCallback(async () => {
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;
    setReading(true);
    setLoading(true);
    try {
      const params = new URLSearchParams({ repoDetails: '1' });
      if (rootPath) params.set('root', rootPath);
      const response = await fetch(`/api/fs/git?${params.toString()}`, { signal: controller.signal });
      const body = (await response.json()) as RepoDetailsPayload;
      if (!aliveRef.current || inFlightRef.current !== controller) return;
      if (!response.ok || !Array.isArray(body.details)) {
        // A refusal is REPORTED, never rendered as an empty list: the two look
        // identical on screen and only one of them is actionable.
        setError(body.error || `Failed to read repositories (HTTP ${response.status})`);
        return;
      }
      setDetails(body.details);
      setError(null);
    } catch (err) {
      if (!aliveRef.current || inFlightRef.current !== controller) return;
      // An abort is a superseded read, not a failure: the newer one owns the
      // state from here.
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to read repositories');
    } finally {
      if (aliveRef.current && inFlightRef.current === controller) {
        inFlightRef.current = null;
        setReading(false);
        setLoading(false);
      }
    }
  }, [rootPath]);

  useEffect(() => {
    if (!open) {
      // A closed dialog keeps nothing: reopening on another workspace must not
      // flash the previous root's repositories.
      setDetails([]);
      setError(null);
      setLoading(false);
      return;
    }
    void read();
    // `scanning` and `reposKey` are triggers, not inputs: the read is for the
    // whole list, and either one moving means the answer may now differ.
  }, [open, read, reposKey, scanning, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { details, loading, reading, error, refresh };
}
