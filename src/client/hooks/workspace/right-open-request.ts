/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * An EXPLICIT "open this view" for the right column, as opposed to the restored
 * `layout.activeRightPanel`.
 *
 * Those are two different facts and stating them with one value is why a fresh
 * tab-style install opened `Files` on its own:
 *
 * - `layout.activeRightPanel` is a RESTORED per-session selection. Under the
 *   rail it decides which view is on screen on load, which is what a returning
 *   user expects; under the tab style the column's default is an EMPTY strip, so
 *   the same value must not be read as "the user asked for this view".
 * - A request is somebody SAYING SO: the rail's own button, a panel dragged onto
 *   the column, `omp:open-panel` from a plugin's navbar entry. Only that may add
 *   a tab.
 *
 * The `nonce` exists because a request is an EVENT, not a state: two presses on
 * the same view are two openings (the second focuses the tab the first created),
 * and an effect keyed on the view alone would run once.
 */

import { useCallback, useState } from 'preact/hooks';

/** A view asked for by name, with the counter that makes two presses two events. */
export interface RightOpenRequest {
  panelKey: string;
  nonce: number;
}

export interface RightOpenRequestHandle {
  /** The latest request, or `null` before anything asked. */
  request: RightOpenRequest | null;
  /** Ask for a view. Also writes the stored selection, which older readers use. */
  requestPanel: (panelKey: string) => void;
}

export function useRightOpenRequest(
  setActiveRightPanel: (panelKey: string) => void,
): RightOpenRequestHandle {
  const [request, setRequest] = useState<RightOpenRequest | null>(null);
  const requestPanel = useCallback(
    (panelKey: string) => {
      setActiveRightPanel(panelKey);
      setRequest((previous) => ({ panelKey, nonce: (previous?.nonce ?? 0) + 1 }));
    },
    [setActiveRightPanel],
  );
  return { request, requestPanel };
}
