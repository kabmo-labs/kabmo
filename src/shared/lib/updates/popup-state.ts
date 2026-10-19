/**
 * The "already shown" latch for the update popup.
 *
 * The popup may appear ONCE PER VERSION, not once per installation: the marker
 * holds the newest version that has already been announced, so the next release
 * announces itself while the current one never interrupts a second time. A
 * permanent boolean would make the feature self-destruct after the first update
 * it ever offered, and a per-page-load flag would re-announce the same version
 * on every reload — which is what the user sees, so the durable copy is what
 * matters.
 *
 * The store is `app_settings` through the shared settings client, deliberately:
 * this repository has no localStorage (SQLite is the single source of truth, see
 * `@/shared/lib/settings/client`), and the marker is per INSTALL, not per session
 * — so it does not belong in `session_ui_state` beside a session's layout.
 */

import { readChamberSetting, writeSetting } from '@/shared/lib/settings/client';

/** Top-level `app_settings` key holding the announced version. */
export const UPDATE_POPUP_SETTING_KEY = 'omp_update_popup_version';

/**
 * Window event that opens the popup on demand.
 *
 * The automatic announcement is once per version; the About modal's "What's
 * new" is the way back to the same notes afterwards, and it reaches the popup
 * through this event rather than through a second copy of its state. The event
 * is named for what it does, not for the component that listens.
 */
export const UPDATE_POPUP_OPEN_EVENT = 'omp:update-popup';

/**
 * Window event that opens the About modal and starts the Kabmo update.
 *
 * The popup's "Update now" does not run the update itself: the About modal is
 * where an update is driven from, and it owns the live output and the per-target
 * rows. So the popup announces, then hands the run over — one dialog owns the
 * run, and the popup cannot leave a second copy of it behind.
 */
export const UPDATE_REQUEST_EVENT = 'omp:update-request';

/**
 * The version already announced on this install, or null.
 *
 * Read from the boot snapshot, so the gate costs no request: the popup's whole
 * purpose is to be decided before any network call is made for it.
 */
export function readAnnouncedVersion(): string | null {
  const stored = readChamberSetting<string>(UPDATE_POPUP_SETTING_KEY);
  return typeof stored === 'string' && stored.trim().length > 0 ? stored.trim() : null;
}

/**
 * Whether this version still owes the user an announcement. An absent marker
 * shows (the common first run), a marker for another version shows (a newer
 * release arrived), and the same version does not.
 */
export function shouldAnnounce(version: string | null, announced = readAnnouncedVersion()): boolean {
  if (!version) return false;
  return version !== announced;
}

/** Record the version as announced. Called when the popup is actually SHOWN. */
export function markAnnounced(version: string): void {
  writeSetting(UPDATE_POPUP_SETTING_KEY, version);
}
