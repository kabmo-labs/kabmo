import { json, NO_STORE_HEADERS } from '@/server/lib/remix-compat';
import { fetchShellRelease, type ShellRelease } from '@/server/lib/updates/shell-release';

/**
 * GET /api/updates/ios — the newest iOS shell a visitor can install.
 *
 * A separate route from `/api/updates/android` even though both read the same
 * release list: the two shells are different artifacts on different tracks, and
 * one endpoint answering "the newest shell" would force the client to say which
 * one it meant in a query string — a parameter whose absence silently means
 * Android.
 *
 * Only an INSTALLED shell asks for this. There is no browser-side install offer
 * on iOS (an IPA cannot be sideloaded from a page the way an APK can), so the
 * payload is only ever compared against `KabmoIOS/<version>`.
 *
 * A failed probe is a valid answer (`url: null`), never a 500: the sidebar's job
 * is to omit a button it cannot back with a link.
 */
export async function loader() {
  const release: ShellRelease | null = await fetchShellRelease('ios');
  return json(
    release ?? { url: null, latest: null, releaseUrl: null },
    { headers: NO_STORE_HEADERS },
  );
}
