/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `GET /api/panels` — every installed panel plugin, grouped by marketplace.
 *
 * The client's only source for the activity-bar entries a plugin contributes.
 * Rejected plugin directories travel with the payload so a manifest Kabmo
 * refused is visible in the UI rather than indistinguishable from a plugin that
 * was never installed.
 *
 * `?refresh=1` drops the server's 5-second scan cache. The Settings pane's
 * Refresh button sends it: without the bypass the button would re-read the
 * client's copy of a scan the server had cached, so a plugin copied in moments
 * ago would still be missing — the same reasoning the Usage panel's Refresh
 * follows.
 */

import { json, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { discoverPanelPlugins, invalidatePanelScan } from '@/server/lib/panels/registry.server';

export async function loader({ request }: LoaderFunctionArgs) {
  if (new URL(request.url).searchParams.get('refresh') === '1') invalidatePanelScan();
  return json(await discoverPanelPlugins(), { headers: { 'cache-control': 'no-store' } });
}
