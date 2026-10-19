/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Live terminal inventory.
 *
 * The panel persists its terminal id per Kabmo session, so a reload normally
 * reattaches to the shell it already owns. This endpoint covers the case where
 * that id is gone (cleared storage, a second browser, a new tab): the client can
 * see which shells are alive in the active scope and adopt one instead of
 * leaving it to the idle reaper.
 */

import { json, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { listTerminals } from '@/server/lib/terminal/liveness.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return json({
    terminals: await listTerminals(url.searchParams.get('root'), url.searchParams.get('repo')),
  });
}
