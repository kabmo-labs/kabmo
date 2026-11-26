/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * This server's stable identity, and why it is a key rather than a hostname.
 *
 * A paired device pins `serverId` and refuses a candidate that answers with a
 * different one. That check is what stops a LAN address reassigned by DHCP from
 * receiving a device's token: the address is not the identity, and a hostname is
 * not either (two machines can be called `macbook`).
 *
 * The id is derived from a random key persisted in the data directory, so it
 * survives a restart, a port change and a LAN address change — the three things
 * that must NOT invalidate a pairing. It is deliberately not derived from the
 * machine's hardware id: that would make two installs on one machine share an
 * identity, and a copied data directory is already the case the relay-style
 * designs have to handle explicitly.
 */

import fs from 'fs';
import path from 'path';
import { getDataDir } from '@kabmo-labs/kabmo-paths/paths';

interface IdentityFile {
  v: 1;
  /** base64url of 32 random bytes. Never leaves the machine. */
  key: string;
}

interface Identity {
  serverId: string;
  key: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoConnectIdentity: Identity | undefined;
}

function deriveServerId(key: string): string {
  return new Bun.CryptoHasher('sha256').update(key).digest('base64url');
}

/**
 * The identity, minted on first read.
 *
 * A corrupt or unreadable file is REPLACED rather than treated as first run
 * silently: the caller gets a new id, and every paired device will refuse it
 * until it is paired again. That is the honest outcome — the alternative is a
 * server that cannot answer its own identity at all.
 */
export function connectIdentity(): Identity {
  const cached = globalThis.__kabmoConnectIdentity;
  if (cached) return cached;

  const file = path.join(getDataDir(), 'connect-identity.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<IdentityFile>;
    if (typeof parsed.key === 'string' && parsed.key.length >= 32) {
      const identity = { key: parsed.key, serverId: deriveServerId(parsed.key) };
      globalThis.__kabmoConnectIdentity = identity;
      return identity;
    }
  } catch {
    // Absent or unreadable: minted below.
  }

  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const identity = { key, serverId: deriveServerId(key) };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ v: 1, key } satisfies IdentityFile), { mode: 0o600 });
  } catch {
    // A read-only data directory still gets a working identity for this process;
    // it just will not survive a restart, and the next boot mints another.
  }
  globalThis.__kabmoConnectIdentity = identity;
  return identity;
}
