import { json, NO_STORE_HEADERS } from '@kabmo-labs/kabmo-http';
import { buildUpdateChangelog } from '@/server/lib/updates/changelog';

/**
 * GET /api/updates/changelog — the release range the "What's new" popup renders.
 *
 * The range is derived SERVER-side from the installed version and GitHub's own
 * release list; there is no `from`/`to` parameter, because a caller that could
 * name its own range could ask for one this install never had. The payload
 * always carries a shape the popup can render — a failure is an `error` field,
 * not a 500 — so an update the check just reported never opens an empty dialog.
 */
export async function loader() {
  try {
    return json(await buildUpdateChangelog(), { headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read release notes';
    return json(
      {
        current: null,
        latest: null,
        versions: [],
        total: 0,
        truncated: false,
        releaseUrl: null,
        install: { method: 'unmanaged', reason: 'unknown', manual: true, command: null },
        error: message,
      },
      { headers: NO_STORE_HEADERS },
    );
  }
}
