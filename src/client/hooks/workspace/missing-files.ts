/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which OPEN editor tabs no longer name a file on disk.
 *
 * A file can vanish from under an open tab — the user deletes it in the Files
 * panel, the agent deletes it, another process removes it. The editor cannot
 * notice by reading: `useFileEditor` caches a tab's bytes and deliberately KEEPS
 * them when a re-read fails (only a first load reports), so the buffer stays on
 * screen and the tab keeps looking normal. This asks the narrower question the
 * tab strip needs — "is the thing this tab names still there?" — and reports the
 * answer as a set of tab ids.
 *
 * It re-probes on EVENTS, never on a timer: the tab set changing, a workspace
 * refresh (a panel's own Refresh, a save, a Files-panel delete — all of which
 * bump `refreshKey`), and the window regaining focus. Deliberately NOT the
 * `fs:<scope>` realtime topic: subscribing to it here would keep a directory
 * listing alive for the whole session, which is one `git check-ignore` spawn per
 * tool call for a decoration.
 *
 * A tab is keyed by its `root\0repo\0path` scope, not by its path alone: the
 * same relative path in two workspaces (or two repos) is two different files,
 * and a probe answered for one must never mark the other.
 */

import { useEffect, useRef, useState } from 'preact/hooks';

/** The identity a probe is asked about: the file, in the tree it was opened from. */
export interface OpenTabScope {
  id: number | string;
  path?: string;
  root?: string;
  repo?: string;
}

/** The scope key a probe's verdict is stored under. Exported for its test. */
export function openTabScopeKey(tab: OpenTabScope): string {
  return `${tab.root ?? ''}\u0000${tab.repo ?? '.'}\u0000${tab.path ?? ''}`;
}

/**
 * Whether `tab` still names a file on disk.
 *
 * A refused or unreadable probe answers `true`: it says nothing about the file,
 * and reporting it as missing would strike through a tab over a dropped
 * request. Only an explicit `exists: false` is a verdict.
 */
async function probeExists(tab: OpenTabScope): Promise<boolean> {
  const params = new URLSearchParams({ path: tab.path ?? '' });
  if (tab.root) params.set('root', tab.root);
  if (tab.repo && tab.repo !== '.') params.set('repo', tab.repo);
  try {
    const res = await fetch(`/api/fs/exists?${params.toString()}`);
    const data = (await res.json().catch(() => null)) as { exists?: unknown } | null;
    if (!res.ok || !data || typeof data.exists !== 'boolean') return true;
    return data.exists;
  } catch {
    return true;
  }
}

/**
 * The tab ids whose file is gone.
 *
 * `refreshKey` is the workspace's own "something was written" counter, so a
 * delete issued from any panel reaches here without a poll. The CALLER decides
 * which tabs are plain files — a diff tab and an attachment chip have no file
 * behind their `path`, and probing one would strike it through on sight.
 */
export function useMissingFiles(tabs: readonly OpenTabScope[], refreshKey: number): Set<number | string> {
  const [missing, setMissing] = useState<Set<number | string>>(() => new Set());
  // Bumped by a focus or a visibility change: the effect below owns the probe,
  // and re-running it is the whole repair for an external deletion.
  const [nonce, setNonce] = useState(0);
  // What the effect watches. Derived from the tabs themselves so a fresh array
  // identity on every render is not a dependency, and stable across a re-render
  // that changed nothing about which files are open.
  const signature = tabs.map((tab) => `${tab.id}\u0001${openTabScopeKey(tab)}`).join('\n');
  // The tab set as it is when the probe resolves, read through a ref so a tab
  // closed mid-probe cannot be reported from a stale array.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const lastIdsRef = useRef<Set<number | string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const probes = new Map<string, OpenTabScope>();
      for (const tab of tabsRef.current) {
        if (tab.path) probes.set(openTabScopeKey(tab), tab);
      }
      const results = await Promise.all(
        [...probes.entries()].map(async ([key, tab]) => ({ key, exists: await probeExists(tab) })),
      );
      if (cancelled) return;

      const gone = new Set<string>();
      for (const { key, exists } of results) if (!exists) gone.add(key);

      const next = new Set<number | string>();
      for (const tab of tabsRef.current) {
        if (tab.path && gone.has(openTabScopeKey(tab))) next.add(tab.id);
      }
      // A fresh Set only when the verdict moved: the tab strip is cheap, but a
      // new identity on every probe would re-render it for nothing.
      const previous = lastIdsRef.current;
      if (previous.size === next.size && [...next].every((id) => previous.has(id))) return;
      lastIdsRef.current = next;
      setMissing(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [signature, refreshKey, nonce]);

  useEffect(() => {
    // Coming back to the tab is when an external deletion (a Finder delete, a
    // terminal `rm`) is most likely to be waiting to be noticed.
    const reprobe = () => setNonce((n) => n + 1);
    window.addEventListener('focus', reprobe);
    document.addEventListener('visibilitychange', reprobe);
    return () => {
      window.removeEventListener('focus', reprobe);
      document.removeEventListener('visibilitychange', reprobe);
    };
  }, []);

  return missing;
}
