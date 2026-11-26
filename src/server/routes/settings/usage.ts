import { json } from '@kabmo-labs/kabmo-http';
import type { LoaderFunctionArgs } from '@kabmo-labs/kabmo-http';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { buildUsageReport } from '@/server/lib/usage/report.server';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

/**
 * GET /api/settings/usage — provider quota and balance.
 *
 * Only providers with a detected credential appear in `providers`; a provider
 * whose key is missing is omitted rather than rendered as an empty row. A
 * provider-side failure is a per-provider `error` (HTTP 200), and only a
 * genuinely unexpected internal failure returns 500.
 *
 * The body comes from `buildUsageReport`, the SAME builder the realtime `usage`
 * topic resolves — the right panel renders whichever read is newer, so a
 * divergent shape here is a crash there, not a stale reading.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return methodNotAllowed({ request, params });
  }
  try {
    // `?refresh=1` is the user's own Refresh button: provider quota is cached
    // for a minute (each read calls every provider's endpoint), but a manual
    // refresh must show fresh numbers rather than that snapshot.
    const force = new URL(request.url).searchParams.get('refresh') === '1';
    return json(await buildUsageReport({ force }), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Failed to load usage' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
