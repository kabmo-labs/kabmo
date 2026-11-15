/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/connect/devices` — the paired list.
 * `DELETE /api/connect/devices?id=…` — revoke one.
 * `POST /api/connect/devices` — a device reports the route it is using.
 *
 * The report is a POST rather than a side effect of every request: the auth gate
 * runs on every call and is synchronous, so writing a row there would put a
 * database write in front of every frame. A device reports once when it
 * connects, which is exactly the fact the page displays.
 */

import { json, NO_STORE_HEADERS, type ActionFunctionArgs } from '@/server/lib/remix-compat';
import { listPairedDevices, revokeDevice, touchDevice } from '@/server/lib/connect/devices.server';
import { bearerToken } from '@/server/lib/sessions/agent-token.server';
import { verifyDeviceToken } from '@/server/lib/connect/devices.server';
import type { ConnectRouteKind } from '@/shared/lib/connect/types';

const ROUTE_KINDS: readonly ConnectRouteKind[] = ['cloudflare', 'lan', 'tailscale'];

export async function loader() {
  return json({ devices: await listPairedDevices() }, { headers: NO_STORE_HEADERS });
}

export async function action({ request }: ActionFunctionArgs) {
  const url = new URL(request.url);

  if (request.method === 'DELETE') {
    const id = url.searchParams.get('id') ?? '';
    if (!id) return json({ error: 'Expected ?id=' }, { status: 400, headers: NO_STORE_HEADERS });
    const revoked = await revokeDevice(id);
    if (!revoked) return json({ error: 'No such device' }, { status: 404, headers: NO_STORE_HEADERS });
    return json({ ok: true, devices: await listPairedDevices() }, { headers: NO_STORE_HEADERS });
  }

  if (request.method === 'POST') {
    const deviceId = verifyDeviceToken(bearerToken(request));
    if (!deviceId) {
      return json({ error: 'A device token is required' }, { status: 401, headers: NO_STORE_HEADERS });
    }
    const body = (await request.json().catch(() => null)) as { route?: unknown; rttMs?: unknown } | null;
    const route = ROUTE_KINDS.find((kind) => kind === body?.route);
    const rttMs = typeof body?.rttMs === 'number' && Number.isFinite(body.rttMs) ? Math.round(body.rttMs) : null;
    if (!route || rttMs === null) {
      return json({ error: 'Expected { route, rttMs }' }, { status: 400, headers: NO_STORE_HEADERS });
    }
    await touchDevice(deviceId, { route, rttMs });
    return json({ ok: true }, { headers: NO_STORE_HEADERS });
  }

  return json({ error: 'Method not allowed' }, { status: 405, headers: NO_STORE_HEADERS });
}
