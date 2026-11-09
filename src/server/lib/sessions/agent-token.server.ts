/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The credential an agent uses to call back into Kabmo.
 *
 * A browser has a cookie; a subprocess does not. Every spawned session gets one
 * random token in its environment, and the CLI presents it as a bearer token.
 * Only the SHA-256 hash is stored, so the database cannot be replayed as a
 * credential.
 *
 * The gate is synchronous and runs on every request, so verified hashes are
 * mirrored in memory: `initAgentTokens` loads them once at boot, mint/revoke
 * update both sides. A restart re-reads the table, which is what makes a token
 * outlive the process that minted it.
 */

import { getDb } from '@/server/db.server';

interface CacheEntry {
  sessionId: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoAgentTokens: Map<string, CacheEntry> | undefined;
}

function cache(): Map<string, CacheEntry> {
  globalThis.__kabmoAgentTokens ??= new Map();
  return globalThis.__kabmoAgentTokens;
}

export function hashAgentToken(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}

/** Load every non-revoked token hash into the gate's cache. Call once at boot. */
export async function initAgentTokens(): Promise<void> {
  try {
    const db = await getDb();
    const rows = (await db.all(
      'SELECT session_id, token_hash FROM session_agent_tokens WHERE revoked_at IS NULL',
    )) as { session_id: string; token_hash: string }[];
    const next = new Map<string, CacheEntry>();
    for (const row of rows) next.set(row.token_hash, { sessionId: row.session_id });
    globalThis.__kabmoAgentTokens = next;
  } catch {
    // A database opened before this table existed has no agent credentials;
    // the browser path is unaffected.
  }
}

/** A fresh token VALUE, before the session id exists. */
export function createAgentToken(): string {
  return `kabmo_agent_${crypto.randomUUID().replace(/-/g, '')}`;
}

/** Record the token against the session the spawn actually produced. */
export async function rememberAgentToken(sessionId: string, token: string): Promise<void> {
  const hash = hashAgentToken(token);
  cache().set(hash, { sessionId });
  const db = await getDb();
  await db.run(
    `INSERT INTO session_agent_tokens (session_id, token_hash, created_at, revoked_at)
     VALUES (?, ?, ?, NULL)
     ON CONFLICT(session_id) DO UPDATE SET token_hash = excluded.token_hash, revoked_at = NULL`,
    [sessionId, hash, Date.now()],
  );
}

/** The session a bearer token identifies, or null. Synchronous by contract. */
export function verifyAgentToken(token: string | null): string | null {
  if (!token) return null;
  return cache().get(hashAgentToken(token))?.sessionId ?? null;
}

/** The value from an `Authorization: Bearer …` header, or null. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

/** The environment a spawned child needs to reach this server. */
export function agentEnvironment(token: string): Record<string, string> {
  const port = Number(Bun.env.PORT) || 3000;
  return {
    KABMO_AGENT_TOKEN: token,
    KABMO_SERVER_URL: Bun.env.KABMO_SERVER_URL || `http://localhost:${port}`,
  };
}

/**
 * What a token may touch, by path.
 *
 * `'any'` is only spawn: a child must be allowed to create its own children.
 * Every other path carries the session id it names, and the token must be that
 * session's. A token is not an admin credential.
 */
export function agentTokenScopeForPath(pathname: string): 'any' | string | null {
  if (pathname === '/api/sessions/spawn') return 'any';
  const direct = /^\/api\/(?:agent|chat)\/([^/]+)$/.exec(pathname);
  if (direct) return direct[1] ?? null;
  const sub = /^\/api\/sessions\/([^/]+)\/(?:fork|relations|answer)$/.exec(pathname);
  return sub?.[1] ?? null;
}

/** Drop the in-memory entry for a session whose rows are being purged. */
export function forgetAgentTokenCache(sessionId: string): void {
  for (const [hash, entry] of cache()) {
    if (entry.sessionId === sessionId) cache().delete(hash);
  }
}

export async function revokeAgentToken(sessionId: string): Promise<void> {
  const db = await getDb();
  await db.run('UPDATE session_agent_tokens SET revoked_at = ? WHERE session_id = ?', [
    Date.now(),
    sessionId,
  ]);
  for (const [hash, entry] of cache()) {
    if (entry.sessionId === sessionId) cache().delete(hash);
  }
}
