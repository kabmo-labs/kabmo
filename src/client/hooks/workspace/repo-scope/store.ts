/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Nested-repo discovery store, keyed by workspace root.
 *
 * The leak this module exists to prevent: a repo is a path RELATIVE to a root
 * (`projects/jns6_5/token` only names a directory under `~/JatisMobile/Workspace`),
 * so a list discovered for one workspace is meaningless under another. Keying
 * every entry by the root it was discovered for makes that structural — a new
 * root has no entry and starts from {@link UNKNOWN_LIST} instead of inheriting
 * the previous list.
 *
 * A store rather than a fetch per hook: the right-panel views ask the same
 * question about the same root, and independent copies meant one subscription
 * per panel plus lists that could disagree.
 *
 * The read rides the `repos:<root>` realtime topic. Discovery runs in the
 * background server-side, so the topic answers `reposPending: true` first and
 * the server re-publishes it the moment the walk finishes — which is what the
 * retry timer this replaced was guessing at.
 */

import { realtimeClient } from '@/shared/lib/realtime/client';
import { reposTopic } from '@/shared/lib/realtime/protocol';
import { isRecord } from '@/shared/lib/util/guards';

export interface RepoListSnapshot {
  repos: string[];
  /** Discovery is still running server-side, or a forced rescan is. */
  scanning: boolean;
}

/** The list before discovery has answered: the workspace root alone. */
export const UNKNOWN_LIST: RepoListSnapshot = { repos: ['.'], scanning: false };

/** A `?reposOnly=1` payload, validated field by field. */
function readRepoPayload(data: unknown): { repos: string[]; scanning: boolean } | null {
  if (!isRecord(data) || !Array.isArray(data.repos)) return null;
  return {
    repos: data.repos.filter((r): r is string => typeof r === 'string'),
    scanning: data.reposPending === true,
  };
}

interface RootEntry {
  snapshot: RepoListSnapshot;
  listeners: Set<() => void>;
  /** The topic's own unsubscribe, held while the root has listeners. */
  detach: (() => void) | null;
  /** The rescan request in flight, so a caller can await its settlement. */
  pending: Promise<void> | null;
}

export interface RepoStore {
  /** Repos discovered for `root`; {@link UNKNOWN_LIST} until one is. */
  snapshot: (root: string) => RepoListSnapshot;
  /** Await the discovery in flight for `root` (a no-op when there is none). */
  settled: (root: string) => Promise<void>;
  /** Observe `root`; the first subscriber starts discovery. Returns a cancel. */
  subscribe: (root: string, listener: () => void) => () => void;
  /** Re-run discovery for `root` from scratch, ignoring any cached result. */
  rescan: (root: string) => void;
}

export interface RepoStoreOptions {
  /** `fetch` seam for the forced rescan, which the topic does not express. */
  fetch: (url: string) => Promise<unknown>;
}

export function createRepoStore({ fetch: fetchImpl }: RepoStoreOptions): RepoStore {
  // Per-store, not module-level: two stores must not share state, and a test
  // store must not see the app store's roots.
  const entries = new Map<string, RootEntry>();

  function entryFor(root: string): RootEntry {
    let entry = entries.get(root);
    if (!entry) {
      entry = { snapshot: UNKNOWN_LIST, listeners: new Set(), detach: null, pending: null };
      entries.set(root, entry);
    }
    return entry;
  }

  function publish(root: string, patch: Partial<RepoListSnapshot>): void {
    const entry = entries.get(root);
    if (!entry) return;
    const next = { ...entry.snapshot, ...patch };
    if (next.repos === entry.snapshot.repos && next.scanning === entry.snapshot.scanning) return;
    entry.snapshot = next;
    for (const listener of entry.listeners) listener();
  }

  /** Adopt a topic payload — the read path, snapshot or delta. */
  function adopt(root: string, data: unknown): void {
    const entry = entries.get(root);
    if (!entry) return;
    const parsed = readRepoPayload(data);
    if (!parsed) {
      // A null payload is a root that cannot be read; leave the snapshot as it
      // was so the next subscriber retries instead of sitting on an empty list.
      publish(root, { scanning: false });
      return;
    }
    publish(root, parsed);
  }

  function load(root: string, rescan: boolean): Promise<void> {
    const entry = entryFor(root);
    // A rescan forces the server's walk to restart; the topic then reports the
    // new list. The plain read is the topic's own snapshot, so only the rescan
    // is an explicit request here.
    if (!rescan) return entry.pending ?? Promise.resolve();
    const params = new URLSearchParams({ reposOnly: '1', rescan: '1' });
    if (root) params.set('root', root);
    const pending = fetchImpl(`/api/fs/git?${params.toString()}`)
      .then((data) => adopt(root, data))
      .catch(() => {
        publish(root, { scanning: false });
      });
    entry.pending = pending;
    return pending;
  }

  function subscribe(root: string, listener: () => void): () => void {
    const entry = entryFor(root);
    entry.listeners.add(listener);
    // One subscription per root, shared by every view: the topic delivers one
    // snapshot per root regardless of how many panels asked.
    if (entry.detach === null) {
      publish(root, { scanning: true });
      entry.detach = realtimeClient.subscribe(reposTopic(root), () => {
        adopt(root, realtimeClient.read(reposTopic(root)));
      });
      adopt(root, realtimeClient.read(reposTopic(root)));
    }
    return () => {
      entry.listeners.delete(listener);
      if (entry.listeners.size > 0) return;
      // Nobody is showing this root's list any more: release the topic. The
      // snapshot keeps its `scanning` flag, so the next subscriber resumes.
      entry.detach?.();
      entry.detach = null;
      entry.pending = null;
    };
  }

  return {
    snapshot: (root) => entries.get(root)?.snapshot ?? UNKNOWN_LIST,
    settled: (root) => entries.get(root)?.pending ?? Promise.resolve(),
    subscribe,
    rescan: (root) => void load(root, true),
  };
}

/** The app's single store, over the browser's `fetch`. */
export const repoStore = createRepoStore({
  fetch: async (url) => {
    const response = await fetch(url);
    return response.json();
  },
});
