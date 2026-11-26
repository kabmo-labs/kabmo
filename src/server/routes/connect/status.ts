/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/connect/status` — everything the Connect page draws.
 *
 * Authenticated like every other API route: the payload names the machine, its
 * addresses and its paired devices, which is reconnaissance a stranger should
 * not get for free.
 */

import { json, NO_STORE_HEADERS } from '@kabmo-labs/kabmo-http';
import { connectStatus } from '@/server/lib/connect/status.server';

export async function loader() {
  return json(await connectStatus(), { headers: NO_STORE_HEADERS });
}
