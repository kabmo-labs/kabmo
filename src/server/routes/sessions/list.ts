/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * GET /api/sessions/list — sidebar session list (folders + sessions + live
 * stream statuses). Client-fetched by `useSidebarData` so the folder list is
 * decoupled from SSR: the page shell (appSettings, mobile UA) renders
 * immediately while the heavy omp JSONL scan loads into the skeleton.
 *
 * No action handler — mutations go through their dedicated endpoints
 * (/api/folders/*, /api/sessions/:id/*) and refresh by re-loading this route.
 */

import { json, NO_STORE_HEADERS } from '@kabmo-labs/kabmo-http';
import type { LoaderFunctionArgs } from '@kabmo-labs/kabmo-http';
import { loadSidebarData } from '@kabmo-labs/kabmo-omp-sidebar-data/data.server';
import { requestAutoImport } from '@/server/lib/harness/auto-import.server';

export async function loader(_args: LoaderFunctionArgs) {
  // Opening the sidebar is the moment a terminal chat should appear. The pass is
  // throttled (one per minute) and fire-and-forget: this response carries the
  // list it has, and the import publishes `sidebar-structure` when it lands.
  requestAutoImport();
  const data = await loadSidebarData();
  return json(data, { headers: NO_STORE_HEADERS });
}
