/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Process-wide refcounted pool of CDP connections, keyed by browser ws url.
 * Several viewer sessions can share the project-shared Chromium; the socket is
 * only closed when the last viewer detaches. Stored on `globalThis` so it
 * survives Vite HMR without leaking duplicate sockets.
 */

import { CdpConnection } from '@/shared/lib/browser/cdp';

interface SharedConnection {
  conn: CdpConnection;
  refs: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __ompBrowserConnections: Map<string, SharedConnection> | undefined;
  // Single-flight guard: concurrent acquires for one ws url must share one
  // socket instead of racing to open two and leaking the loser.
  // eslint-disable-next-line no-var
  var __ompBrowserPendingConnects: Map<string, Promise<CdpConnection>> | undefined;
}

function registry(): Map<string, SharedConnection> {
  if (!globalThis.__ompBrowserConnections) globalThis.__ompBrowserConnections = new Map();
  return globalThis.__ompBrowserConnections;
}

function pendingConnects(): Map<string, Promise<CdpConnection>> {
  if (!globalThis.__ompBrowserPendingConnects) globalThis.__ompBrowserPendingConnects = new Map();
  return globalThis.__ompBrowserPendingConnects;
}

/** Get a live connection for `wsUrl` or open one; increments the refcount. */
export async function acquireConnection(wsUrl: string): Promise<CdpConnection> {
  const connections = registry();
  const existing = connections.get(wsUrl);
  if (existing && !existing.conn.closed) {
    existing.refs += 1;
    return existing.conn;
  }

  const pending = pendingConnects();
  let connecting = pending.get(wsUrl);
  if (!connecting) {
    connecting = CdpConnection.connect(wsUrl).finally(() => pending.delete(wsUrl));
    pending.set(wsUrl, connecting);
  }
  const conn = await connecting;

  // Another caller may have completed the same connect and registered it first.
  const current = connections.get(wsUrl);
  if (current && !current.conn.closed) {
    current.refs += 1;
    return current.conn;
  }

  const entry: SharedConnection = { conn, refs: 1 };
  connections.set(wsUrl, entry);
  // Drop a dead entry so the next acquire opens a fresh socket.
  conn.onClose(() => {
    if (connections.get(wsUrl) === entry) connections.delete(wsUrl);
  });
  return conn;
}

/** Release one reference; closes the socket once the refcount reaches zero. */
export function releaseConnection(wsUrl: string, conn: CdpConnection): void {
  const connections = registry();
  const entry = connections.get(wsUrl);
  if (!entry || entry.conn !== conn) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  connections.delete(wsUrl);
  conn.close();
}
