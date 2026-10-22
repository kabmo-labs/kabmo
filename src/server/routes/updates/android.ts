import { json, NO_STORE_HEADERS } from '@/server/lib/remix-compat';
import { fetchShellRelease, type ShellRelease } from '@/server/lib/updates/shell-release';

/**
 * GET /api/updates/android — the newest APK a visitor can download.
 *
 * Its own route rather than a field on `/api/updates/check`: that one answers for
 * the INSTALLED server (npm), this one answers for a different product (the
 * Android shell), and folding them would make one probe's failure look like the
 * other's. The client asks for it only when the sidebar renders, so a console
 * that never shows the button never pays for the read.
 *
 * A failed probe is a valid answer (`url: null`), never a 500: the sidebar's job
 * is to omit a button it cannot back with a link.
 */
export async function loader() {
  const release: ShellRelease | null = await fetchShellRelease('android');
  return json(
    release ?? { url: null, latest: null, releaseUrl: null },
    { headers: NO_STORE_HEADERS },
  );
}
