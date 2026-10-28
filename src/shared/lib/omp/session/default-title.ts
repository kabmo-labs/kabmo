/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Default display titles for sessions that have no user/auto name yet.
 *
 * A brand-new session must still be distinguishable in the sidebar and navbar
 * before omp derives a real title (first prompt / JSONL title slot), so the
 * default carries the creation timestamp:
 *
 *   New Session - yyyy-mm-ddThh:mm:ss
 *
 * The timestamp is local time and is stable per session: pending sessions take
 * it from their `new-<epochMs>` id, persisted sessions from the JSONL header
 * timestamp — two nameless sessions can never render the same title.
 */

const PENDING_SESSION_PREFIX = 'new-';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `New Session - yyyy-mm-ddThh:mm:ss` (local time); plain "New Session" when
 *  the date is invalid. */
export function formatNewSessionTitle(date: Date = new Date()): string {
  if (Number.isNaN(date.getTime())) return 'New Session';
  return `New Session - ${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** True for client-side pending session ids (`new-<epochMs>`, pre-spawn). */
export function isPendingSessionId(sessionId: string | null | undefined): boolean {
  return Boolean(sessionId?.startsWith(PENDING_SESSION_PREFIX));
}

/** Creation epoch (ms) encoded in a pending session id (`new-<epochMs>`);
 *  NaN for any other id, including real omp UUIDs. */
export function pendingSessionCreatedAt(sessionId: string | null | undefined): number {
  return sessionId?.startsWith(PENDING_SESSION_PREFIX)
    ? Number(sessionId.slice(PENDING_SESSION_PREFIX.length))
    : Number.NaN;
}

/**
 * Creation epoch (ms) carried by an omp session id itself.
 *
 * omp ids are UUIDv7, whose leading 48 bits are the generation time in
 * milliseconds — so an id the sidebar must render BEFORE omp's transcript scan
 * can surface it still knows when its session was created. Verified against
 * the session files: `01a0ff3d-6f67-…` decodes to 2026-10-03T00:50:11.431Z,
 * which is that file's own creation clock.
 *
 * This is what keeps a placeholder row still. The caller used to fall back to
 * `new Date()` for a non-pending id, so every revalidation re-stamped the row
 * with the CURRENT clock: the title advanced on each list refresh (measured:
 * 07:53:13 → :14 → :18 → :26 within one run) and the row's `updated_at` was
 * perpetually "now", which re-shuffled LATEST_SESSION ordering each time.
 *
 * NaN for anything that is not a v7 UUID (a legacy v4 id, a Kabmo id), so
 * the caller's own fallback still applies.
 */
export function sessionIdEpochMs(sessionId: string | null | undefined): number {
  // `xxxxxxxx-xxxx-7xxx-…`: 8 hex, '-', 4 hex, '-', then the version nibble.
  if (!sessionId || sessionId.length < 15 || sessionId[8] !== '-' || sessionId[13] !== '-' || sessionId[14] !== '7') {
    return Number.NaN;
  }
  const ms = Number.parseInt(sessionId.slice(0, 8) + sessionId.slice(9, 13), 16);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

/** Default title of a client-side pending session; the id carries its
 *  creation epoch (`new-<epochMs>`). An adopted omp UUID carries one in its v7
 *  prefix instead, and using it is what keeps the row's text still: the
 *  `new Date()` fallback re-stamped the title on every revalidate, so the
 *  seconds advanced on each list refresh (measured 07:53:13 → :14 → :18 → :26
 *  within one run) instead of naming the moment the session was created. */
export function pendingSessionTitle(sessionId: string | null | undefined): string {
  const epochMs = pendingSessionCreatedAt(sessionId);
  const stableMs = Number.isFinite(epochMs) ? epochMs : sessionIdEpochMs(sessionId);
  return formatNewSessionTitle(Number.isFinite(stableMs) ? new Date(stableMs) : new Date());
}
