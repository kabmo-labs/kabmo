/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sidebar's full-reload beat: one request for every topic per interval.
 *
 * omp's own writes cover most of the list, but something outside this tab —
 * another Kabmo instance, a CLI-driven run, omp writing a session file late —
 * can move a row with no push reaching this client. The watcher narrows that
 * window; it does not close it. This beat re-reads structure, status and
 * activity so the list converges on its own instead of waiting for a reload.
 *
 * The transport coalesces a request that arrives while a snapshot is in
 * flight, so a slow scan cannot queue snapshots behind each other.
 */

import { useEffect } from 'preact/hooks';

/** How often the sidebar re-reads the whole list, in milliseconds. */
export const SIDEBAR_FULL_RELOAD_MS = 15_000;

/** Re-read every sidebar topic on a fixed beat while the mount is alive. */
export function useSidebarFullReload(refresh: () => void): void {
  useEffect(() => {
    const timer = setInterval(refresh, SIDEBAR_FULL_RELOAD_MS);
    return () => clearInterval(timer);
  }, [refresh]);
}
