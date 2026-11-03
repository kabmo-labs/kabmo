/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET|POST /api/telemetry/tokens` — token and cost usage for the settings
 * panel.
 *
 * The response is ONE payload carrying every view the panel can draw for the
 * requested period (totals, the provider → model tree, daily rows with their
 * per-provider split, project rows). Cadence and breakdown tabs are therefore
 * client-side re-buckets, not requests — the previous shape answered a fresh
 * full scan for each one.
 *
 * What is deliberately absent:
 *  - `rangeData` / `breakdownData`: three copies of data the panel never read.
 *    It kept only `metrics`, `breakdownRows` and `chartSeries`.
 *  - `pricing`: the models.dev catalog was fetched (5.96 MB, measured 5.63 s,
 *    8 s timeout) on every request and no client code ever read the result.
 *
 * `?refresh=1` re-checks the sessions tree before answering; without it the
 * index is at most 20 seconds stale, which is what makes a period change cost
 * milliseconds.
 */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { isMockMode } from '@/server/mock.server';
import { buildTokenUsagePayload } from '@/server/lib/usage/index-query.server';
import { mockTokenUsagePayload } from '@/client/data/mock/token-usage';
import type { TimeRangeType } from '@/shared/types';

const RANGES: readonly TimeRangeType[] = ['today', '7d', '30d', '90d', 'all', 'custom'];
/** Never cached: the index can change under a client that is polling. */
const HEADERS = { 'cache-control': 'no-store' };

function readQuery(url: URL): { range: TimeRangeType; customFrom: string | null; customTo: string | null } {
  const requested = url.searchParams.get('range') ?? url.searchParams.get('timeRange') ?? '30d';
  const range = (RANGES as readonly string[]).includes(requested) ? (requested as TimeRangeType) : '30d';
  return {
    range,
    customFrom: url.searchParams.get('customFrom'),
    customTo: url.searchParams.get('customTo'),
  };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method !== 'GET') return methodNotAllowed({ request, params });
  const url = new URL(request.url);
  const query = readQuery(url);

  if (isMockMode()) return json(mockTokenUsagePayload(query.range), { headers: HEADERS });

  try {
    const payload = await buildTokenUsagePayload(query);
    return json(payload, { headers: HEADERS });
  } catch (error) {
    // A failure is REPORTED, never rendered as "$0.00 usage": an empty panel
    // claiming zero spend is indistinguishable from a month without work.
    return json(
      { error: error instanceof Error ? error.message : 'Failed to read token usage' },
      { status: 500, headers: HEADERS },
    );
  }
}

/**
 * POST — force a re-check of the sessions tree.
 *
 * The panel's Refresh button. It answers with the same payload shape so the
 * client can replace its state in one step.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params });
  const url = new URL(request.url);
  const query = readQuery(url);
  if (isMockMode()) return json(mockTokenUsagePayload(query.range), { headers: HEADERS });
  try {
    return json(await buildTokenUsagePayload({ ...query, wait: true, force: true }), { headers: HEADERS });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Failed to read token usage' },
      { status: 500, headers: HEADERS },
    );
  }
}
