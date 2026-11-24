/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Antigravity's quota CONTRACT: the shapes it stores and the windows it
 * reports, with no I/O so the mapping can be pinned without a network or a
 * keyring. The reader that talks to the machine lives in `antigravity.ts`.
 *
 * Measured on this machine, 2026-11-24:
 *
 *  - The macOS keyring item is service `gemini`, account `antigravity`, and its
 *    value is `go-keyring-base64:` + base64 of
 *    `{ token: { access_token, refresh_token, expiry }, auth_method: "consumer" }`.
 *    `~/.gemini/jetski-standalone-oauth-token` holds the same shape for builds
 *    that write a file instead of a keyring item (the copy here was stale).
 *  - `~/.gemini/antigravity-cli/cache/default_project_id.txt` holds the Cloud
 *    Code project (`default-cli-project`).
 *  - `POST .../v1internal:retrieveUserQuotaSummary` with `{ project }` answers
 *    `groups[].buckets[]`: `Gemini Models` (`gemini-weekly`, `gemini-5h`) and
 *    `Claude and GPT models` (`3p-weekly`, `3p-5h`), each bucket carrying
 *    `remainingFraction` (1 = untouched) and `resetTime`.
 *  - The Gemini-CLI credential (`~/.gemini/oauth_creds.json`) is NOT usable
 *    here: it authenticates `loadCodeAssist` and answers 403 PERMISSION_DENIED
 *    on both quota paths, so only the Antigravity sign-in is read.
 */

import { num } from '@/server/lib/usage/window';
import { isRecord } from '@/shared/lib/util/guards';
import type { UsageLimitWindow, UsageWindowStatus } from '@/shared/types';

/** The provider row a local sign-in belongs to when omp has no row of its own. */
export const ANTIGRAVITY_PROVIDER_ID = 'google-antigravity';

/** What the card prints as the credential's provenance. */
export const ANTIGRAVITY_CREDENTIAL_SOURCE = 'antigravity';

const KEYRING_PREFIX = 'go-keyring-base64:';

export interface AntigravityCredential {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms, when the store states one. */
  expiresAt?: number;
}

/** One local sign-in's quota. `windows` empty plus `error` set is a failure. */
export interface LocalAntigravityReport {
  windows: UsageLimitWindow[];
  error?: string;
}

/**
 * Decode a keyring file value: `go-keyring-base64:<base64 JSON>`, or plain JSON
 * for a build that writes the token uncompressed.
 */
export function decodeKeyringSecret(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const encoded = trimmed.startsWith(KEYRING_PREFIX);
  const body = encoded ? trimmed.slice(KEYRING_PREFIX.length) : trimmed;
  try {
    return JSON.parse(encoded ? Buffer.from(body, 'base64').toString('utf8') : body);
  } catch {
    return null;
  }
}

/**
 * Both stored shapes: the Antigravity bundle (`{ token: {...} }`) and a flat
 * credential. Anything without an access token is not a credential — returning
 * null keeps "not signed in" separate from "expired".
 */
export function parseAntigravityCredential(raw: unknown): AntigravityCredential | null {
  if (!isRecord(raw)) return null;
  const token = isRecord(raw.token) ? raw.token : raw;
  const accessToken = typeof token.access_token === 'string' ? token.access_token.trim() : '';
  if (!accessToken) return null;
  const refreshToken = typeof token.refresh_token === 'string' && token.refresh_token.trim().length > 0
    ? token.refresh_token.trim()
    : undefined;
  const expiry = typeof token.expiry === 'string'
    ? Date.parse(token.expiry)
    : num(token.expiry_date) ?? num(token.expiry);
  const expiresAt = expiry !== undefined && Number.isFinite(expiry) ? expiry : undefined;
  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}

/** The project file's content: one trimmed token, or nothing. */
export function parseAntigravityProject(text: string | null): string | null {
  const project = (text ?? '').trim();
  return project.length > 0 && !/\s/.test(project) ? project : null;
}

/** The model family a bucket belongs to, as the limit id's second segment. */
export function antigravityBucketFamily(bucketId: string, displayName: string): string {
  const id = bucketId.trim().toLowerCase();
  const name = displayName.trim().toLowerCase();
  if (id.startsWith('gemini-argon-')) return 'google-argon';
  if (id.startsWith('gemini-') || name.includes('gemini')) return 'google';
  // Claude and GPT share ONE upstream bucket; the client merges `anthropic`
  // and `openai` onto it, so one segment is enough.
  if (id.startsWith('3p-') || name.includes('claude') || name.includes('gpt') || name.includes('third party')) {
    return 'anthropic';
  }
  return 'default';
}

/** The window a bucket's `window` field names. */
export function antigravityWindow(
  window: string,
): { id: string; label: string; windowLabel?: string } {
  const value = window.trim().toLowerCase();
  if (value.includes('week') || value.includes('7d')) {
    return { id: 'weekly', label: 'Weekly limit', windowLabel: '7d' };
  }
  if (value.includes('5h') || value.includes('five')) {
    return { id: '5h', label: '5-hour limit', windowLabel: '5h' };
  }
  if (value.includes('day') || value.includes('daily') || value.includes('24h')) {
    return { id: 'daily', label: 'Daily limit', windowLabel: '24h' };
  }
  return { id: 'default', label: 'Quota limit' };
}

function remainingFraction(value: unknown): number | undefined {
  const parsed = num(value);
  if (parsed === undefined) return undefined;
  return Math.min(1, Math.max(0, parsed));
}

function statusOf(remaining: number | undefined): UsageWindowStatus {
  if (remaining === undefined) return 'unknown';
  if (remaining <= 0) return 'exhausted';
  if (remaining <= 0.1) return 'warning';
  return 'ok';
}

/**
 * The `retrieveUserQuotaSummary` body as quota windows.
 *
 * Ids keep omp's grammar (`provider:family:default:window`) so the client's
 * existing Antigravity grouping applies unchanged, and a bucket that appears in
 * two groups is emitted once — the same number twice under one heading is not a
 * second fact.
 */
export function antigravityWindows(
  payload: unknown,
  providerId: string = ANTIGRAVITY_PROVIDER_ID,
): UsageLimitWindow[] {
  if (!isRecord(payload)) return [];
  const groups = Array.isArray(payload.groups) ? payload.groups : [];
  const windows: UsageLimitWindow[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    if (!isRecord(group)) continue;
    const buckets = Array.isArray(group.buckets) ? group.buckets : [];
    for (const bucket of buckets) {
      if (!isRecord(bucket) || bucket.disabled === true) continue;
      const bucketId = typeof bucket.bucketId === 'string' ? bucket.bucketId.trim() : '';
      const displayName = typeof bucket.displayName === 'string' ? bucket.displayName.trim() : '';
      const window = antigravityWindow(typeof bucket.window === 'string' ? bucket.window : '');
      const family = antigravityBucketFamily(bucketId, displayName);
      const id = `${providerId}:${family}:default:${window.id}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const remaining = remainingFraction(bucket.remainingFraction);
      const usedFraction = remaining === undefined ? undefined : 1 - remaining;
      const resetsAt = typeof bucket.resetTime === 'string' ? Date.parse(bucket.resetTime) : Number.NaN;
      const note = typeof bucket.description === 'string' ? bucket.description.trim() : '';

      windows.push({
        id,
        label: window.label,
        ...(window.windowLabel ? { windowLabel: window.windowLabel } : {}),
        unit: 'percent',
        status: statusOf(remaining),
        ...(usedFraction !== undefined
          ? { used: usedFraction * 100, limit: 100, remaining: (remaining ?? 0) * 100, usedFraction }
          : {}),
        ...(Number.isFinite(resetsAt) ? { resetsAt } : {}),
        ...(note ? { notes: [note] } : {}),
      });
    }
  }

  // Worst window first, as every other adapter orders its rows: the card's
  // first row is the one that answers "am I about to be cut off".
  return windows.sort((a, b) => (b.usedFraction ?? 0) - (a.usedFraction ?? 0));
}
