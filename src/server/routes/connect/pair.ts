/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `POST /api/connect/pair` — mint a one-time code and its QR.
 * `POST /api/connect/pair/claim` — redeem it for a device token.
 *
 * The two halves have different auth on purpose. Minting requires a session: it
 * is the operator handing out access. Claiming is PUBLIC, because the device
 * doing it has no cookie yet — the one-time secret IS the credential, and it is
 * 32 random bytes with a two-minute life, so it cannot be guessed and cannot be
 * replayed.
 *
 * The claim answers with the server's `serverId` so the device can confirm it
 * reached the machine the QR named. A device that pinned an id and gets a
 * different one must refuse the token it was just handed.
 */

import { json, NO_STORE_HEADERS, type ActionFunctionArgs } from '@/server/lib/remix-compat';
import { connectIdentity } from '@/server/lib/connect/identity.server';
import { connectStatus } from '@/server/lib/connect/status.server';
import { createPairing, attachPairingQr, consumePairing } from '@/server/lib/connect/pairing.server';
import { mintDeviceToken, touchDevice, DEVICE_COOKIE } from '@/server/lib/connect/devices.server';
import { isSecureRequest } from '@/server/lib/auth/token';
import { qrMatrix } from '@/server/lib/connect/qr.server';
import { qrPng } from '@/server/lib/connect/qr-png.server';
import { encodePairingFragment, encodePairingPayload, PAIRING_VERSION } from '@/shared/lib/connect/payload';
import { ROUTE_TIER } from '@/shared/lib/connect/tier';
import type { ConnectCandidate, ConnectRouteKind } from '@/shared/lib/connect/types';

const ROUTE_KINDS: readonly ConnectRouteKind[] = ['cloudflare', 'lan', 'tailscale'];

/**
 * How long the device cookie lives, in seconds.
 *
 * 400 days is the longest Chrome honours; the token itself never expires, so this
 * is the browser's cap rather than a policy. Revocation is the control that ends
 * a pairing, not time.
 */
const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

interface ClaimRequest {
  action?: unknown;
  pairingId?: unknown;
  secret?: unknown;
  name?: unknown;
  platform?: unknown;
  route?: unknown;
  rttMs?: unknown;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405, headers: NO_STORE_HEADERS });
  }

  const url = new URL(request.url);
  const body = (await request.json().catch(() => null)) as ClaimRequest | null;
  const isClaim = url.pathname.endsWith('/claim');

  if (isClaim) {
    const pairingId = typeof body?.pairingId === 'string' ? body.pairingId : '';
    const secret = typeof body?.secret === 'string' ? body.secret : '';
    if (!pairingId || !secret) {
      return json({ error: 'Expected { pairingId, secret }' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const consumed = consumePairing(pairingId, secret);
    if (!consumed.ok) {
      return json({ error: consumed.reason }, { status: 410, headers: NO_STORE_HEADERS });
    }

    const name = typeof body?.name === 'string' ? body.name : 'Device';
    const platform = typeof body?.platform === 'string' ? body.platform : 'unknown';
    const device = await mintDeviceToken({ name, platform });

    const route = ROUTE_KINDS.find((kind) => kind === body?.route);
    const rttMs = typeof body?.rttMs === 'number' && Number.isFinite(body.rttMs) ? Math.round(body.rttMs) : null;
    if (route && rttMs !== null) await touchDevice(device.id, { route, rttMs });

    // The cookie is what a webview can actually send: it cannot attach an
    // `Authorization` header to its own page requests or to a WebSocket upgrade.
    // `HttpOnly` keeps it away from page script; `SameSite=Lax` is enough because
    // every request that matters is same-origin.
    //
    // `Max-Age` is what makes pairing survive a restart. Without it the cookie is
    // a SESSION cookie, which the browser drops when it closes — so a paired phone
    // asked for a password again the next morning, and the whole point of pairing
    // is that it does not. The token itself has no expiry in the database (only
    // revocation), so the cookie's life is the browser's cap rather than a policy:
    // 400 days is the longest Chrome honours.
    const secure = isSecureRequest(request) ? '; Secure' : '';
    return json(
      {
        deviceId: device.id,
        token: device.token,
        serverId: connectIdentity().serverId,
        candidates: consumed.candidates,
      },
      {
        headers: {
          ...NO_STORE_HEADERS,
          'set-cookie': `${DEVICE_COOKIE}=${encodeURIComponent(device.token)}; Path=/; Max-Age=${DEVICE_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`,
        },
      },
    );
  }

  // Minting. Only the addresses that actually answer go into the code: a
  // candidate the device cannot reach would make the first probe fail for no
  // reason, and the page already shows the unavailable ones with their reason.
  const status = await connectStatus();
  const candidates: ConnectCandidate[] = status.addresses
    .filter((address) => address.unavailable === null && address.url !== '')
    .map((address) => ({ kind: address.kind, url: address.url }));

  if (candidates.length === 0) {
    return json(
      {
        error:
          'No reachable address to put in a pairing code. Turn on Tailscale Serve, or start this server with --lan.',
      },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }

  const pairing = createPairing(candidates);
  const payload = {
    v: PAIRING_VERSION as 1,
    pairingId: pairing.pairingId,
    secret: pairing.secret,
    serverId: status.serverId,
    label: status.label,
    expiresAt: pairing.expiresAt,
    candidates,
  };
  const link = encodePairingPayload(payload);

  // The QR carries the BROWSER link, not the deep link: a phone's camera app
  // opens an https URL in the browser, which is what makes pairing work with no
  // native scanner. The best candidate is the lowest tier — Tailscale before
  // LAN, because the LAN origin is not a secure context.
  const best = [...candidates].sort((left, right) => ROUTE_TIER[left.kind] - ROUTE_TIER[right.kind])[0];
  const webLink = `${best.url}/pair#${encodePairingFragment(payload)}`;
  const qr = qrMatrix(webLink);
  // Drawn once, here: the download is an HTTP GET from a host's own download
  // machinery, which cannot run this page's renderer to draw it later.
  attachPairingQr(pairing.pairingId, qrPng(qr));

  return json(
    {
      pairingId: pairing.pairingId,
      expiresAt: pairing.expiresAt,
      link,
      webLink,
      qrUrl: `/api/connect/pair/qr.png?pairingId=${encodeURIComponent(pairing.pairingId)}`,
      candidates,
      qr,
    },
    { headers: NO_STORE_HEADERS },
  );
}
