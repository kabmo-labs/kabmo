/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Installing a desktop shell's own update, from the console.
 *
 * ## Why the shell does the work
 *
 * A page cannot replace the executable it runs inside, and a browser download
 * leaves a file in a folder the user has to find and open. So the button asks
 * the SHELL (`update_apply` over the bridge), and the shell downloads, verifies,
 * replaces and relaunches. What this hook owns is only the part a page can own:
 * the run's state, and reporting the outcome where the user clicked.
 *
 * ## Why it is a hook rather than a function at the call site
 *
 * Both sidebars draw this control and each one unmounts at a different moment (a
 * phone closes the drawer, a desktop swaps sessions). The state has to live with
 * the control that shows it, and the two must report the SAME vocabulary — so the
 * phases and their sentences are here, not in either footer.
 *
 * ## A failure is always a sentence
 *
 * The shell sends its own reason ("the downloaded file is not a signed Kabmo
 * build", "the installer refused with code 5"), which is the only thing that can
 * tell a user what to do next. Nothing here replaces it with a generic failure,
 * and nothing reports success before the shell said so.
 */

import { useCallback, useRef, useState } from 'preact/hooks';
import {
  applyShellUpdate,
  bridgeError,
  isDesktopShell,
  type ShellUpdateOutcome,
} from '@/client/lib/desktop/bridge';
import type { ShellDownload } from '@/client/hooks/ui/updates/shell-download';

/** What the control is doing right now. */
export type ShellUpdatePhase = 'idle' | 'working' | 'done' | 'error';

export interface ShellUpdateState {
  phase: ShellUpdatePhase;
  /** The shell's own sentence, for `done` and `error`. */
  message: string | null;
}

export interface UseShellUpdateResult extends ShellUpdateState {
  /** Run the update this offer names. */
  apply: (download: ShellDownload) => Promise<void>;
  /**
   * Forget the last run, back to `idle`.
   *
   * The dialog calls this when it OPENS: a run that failed last time must not greet
   * the user with its old refusal the next time they press the control.
   */
  reset: () => void;
  /** True while a run is in flight, so the control can disable itself. */
  working: boolean;
}

/**
 * Whether this offer is something the shell can install by itself.
 *
 * Two facts, and both are required. The artifact must be a FILE (`direct`), and
 * the page must be inside the desktop shell that can install it — an Android
 * shell installs through `PackageInstaller` and iOS cannot install at all, so
 * neither belongs to this path. A browser on a desktop gets neither, because
 * there is no shell to ask.
 */
export function canSelfUpdate(download: ShellDownload | null | undefined): boolean {
  if (!download) return false;
  if (!download.direct) return false;
  if (download.platform === 'android' || download.platform === 'ios') return false;
  return isDesktopShell();
}

export function useShellUpdate(): UseShellUpdateResult {
  const [state, setState] = useState<ShellUpdateState>({ phase: 'idle', message: null });
  // A second click while the shell is replacing itself would be a second
  // installer beside the first, so the run is claimed by a ref rather than by
  // the render state — a fast double click lands before the state is read.
  const running = useRef(false);

  const apply = useCallback(async (download: ShellDownload) => {
    if (running.current) return;
    running.current = true;
    setState({ phase: 'working', message: null });

    try {
      const outcome: ShellUpdateOutcome = await applyShellUpdate(download.url, download.latest);
      setState({
        phase: outcome.success ? 'done' : 'error',
        // The shell's sentence is the report. `?? null` rather than a fallback
        // string: a shell that answered nothing has said nothing, and inventing
        // "Update failed" over it would hide that.
        message: outcome.message ?? null,
      });
    } catch (cause) {
      // A refused command (an older shell with no `update_apply`) lands here,
      // and its own message says so.
      setState({ phase: 'error', message: bridgeError(cause) });
    } finally {
      running.current = false;
    }
  }, []);

  const reset = useCallback(() => {
    // A run in flight is NOT resettable: the shell is already replacing itself, and
    // reporting `idle` over it would re-arm a control whose second press would start
    // a second installer.
    if (running.current) return;
    setState({ phase: 'idle', message: null });
  }, []);

  return { ...state, apply, reset, working: state.phase === 'working' };
}
