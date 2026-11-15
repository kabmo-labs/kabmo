/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shapes the Connect page, the pairing QR and the shells all agree on.
 *
 * One module because the same three facts travel through all of them: which
 * addresses this server answers on, which tunnel is up, and which devices have
 * been paired. A second copy of any of these shapes is how the QR starts
 * carrying a field the server stopped sending.
 */

/**
 * How a client reaches this server.
 *
 * The order of this union is NOT the preference order — see `ROUTE_TIER` in
 * `tier.ts`. It is alphabetical-ish by how the address is produced, so a reader
 * scanning a payload does not mistake the declaration order for a ranking.
 */
export type ConnectRouteKind = 'cloudflare' | 'lan' | 'tailscale';

/** One way to reach the server, as it appears in a pairing payload. */
export interface ConnectCandidate {
  kind: ConnectRouteKind;
  /** Origin only — no path, no trailing slash. */
  url: string;
}

/** One address the server knows about, and whether it is usable right now. */
export interface ConnectAddress extends ConnectCandidate {
  /**
   * Why this address cannot be used, when it cannot.
   *
   * A sentence, never a boolean: "tailscale is not running" and "no cloudflared
   * config" are different problems with different fixes, and a greyed-out row
   * with no text is the failure mode this field exists to prevent.
   */
  unavailable: string | null;
}

/** The lifecycle of one tunnel provider. */
export type TunnelPhase = 'off' | 'starting' | 'up' | 'degraded' | 'failed';

export interface TunnelState {
  provider: 'cloudflare' | 'tailscale';
  phase: TunnelPhase;
  /** The public origin while `phase` is `up` or `degraded`. */
  url: string | null;
  /** One sentence naming why it is not up. Null while it is. */
  reason: string | null;
}

/** A device that has redeemed a pairing code. */
export interface PairedDevice {
  id: string;
  name: string;
  /** `ios`, `android`, `macos`, `windows`, `linux`, `web` — self-reported. */
  platform: string;
  /** The route this device last connected over, when it has said. */
  route: ConnectRouteKind | null;
  /** The device's own measurement of that route, in milliseconds. */
  rttMs: number | null;
  lastSeenAt: string | null;
  createdAt: string;
}

/** Everything the Connect page draws, in one read. */
export interface ConnectStatus {
  /**
   * Stable identity of this server, derived from a persisted key.
   *
   * A device pins this and refuses a candidate that answers with a different
   * one: a LAN address handed to another machine by DHCP must not receive the
   * device's token.
   */
  serverId: string;
  /** The machine's display name, so a phone can label the server. */
  label: string;
  version: string;
  addresses: ConnectAddress[];
  tunnels: TunnelState[];
  devices: PairedDevice[];
}

/**
 * A QR code as rows of `0`/`1`.
 *
 * Shared rather than server-only because the client draws it: the server encodes
 * the payload, the page renders one `<rect>` per dark module. Sending markup
 * instead would put a string built from a one-time secret into the DOM.
 */
export interface QrMatrix {
  /** Modules per side, excluding the quiet zone. */
  size: number;
  /** `size` strings of `size` characters, `1` for a dark module. */
  rows: string[];
}
