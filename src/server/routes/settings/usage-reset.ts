import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { listUsageResets, spendUsageReset } from '@/server/lib/usage/reset.server';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

/**
 * GET /api/settings/usage/reset — saved rate-limit resets, per account.
 *
 * A read failure is a 200 with `error` set, not a 500: omp exits 1 when there
 * is nothing to list (`No Codex or Claude accounts found…`), and that is an
 * answer about the user's accounts rather than a chamber fault. The section
 * renders the sentence.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return methodNotAllowed({ request, params });
  }
  try {
    return json(await listUsageResets(), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return json(
      { accounts: [], generatedAt: Date.now(), error: error instanceof Error ? error.message : 'Failed to list saved resets' },
      { headers: NO_STORE_HEADERS },
    );
  }
}

/**
 * POST /api/settings/usage/reset — spend one saved reset.
 *
 * The target is `<provider>/<credentialId>`, the grammar `omp usage reset`
 * itself parses. It is validated here as a single slash-separated pair so a
 * malformed body cannot reach a spawn, and omp's own sentence is returned
 * either way — a refusal (`already_redeemed`, `nothing_to_reset`) is a normal
 * outcome, not an error, so the status stays 200 with `ok: false`.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }
  try {
    const body = await request.json() as { target?: unknown };
    const target = typeof body.target === 'string' ? body.target.trim() : '';
    const parts = target.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return json(
        { ok: false, message: 'A target must be `<provider>/<credential id>`, as the list reports it.' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    return json(await spendUsageReset(target), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return json(
      { ok: false, message: error instanceof Error ? error.message : 'Failed to spend the saved reset' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
