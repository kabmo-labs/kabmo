/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Env a Claude Code gateway needs to accept its requests.
 *
 * Claude Code puts an attribution string in the request body's
 * `metadata.user_id` (`{"device_id":…,"account_uuid":…,"session_id":…}`). The
 * Anthropic API accepts it, but a strict gateway rejects the whole turn:
 * measured against kenari.id, every `/v1/messages` body carrying ANY
 * `metadata.user_id` answered
 *
 * ```
 * 400 the model's provider rejected the request. check the model id and request fields
 * ```
 *
 * while the same body without the field — and the same body with
 * `metadata: {}` — completed. `CLAUDE_CODE_EXTRA_BODY` is merged into the top
 * level of the request, so an empty metadata object replaces the attribution
 * one without touching anything else (thinking, context management, tools).
 *
 * Only a CUSTOM base URL gets this: a direct Anthropic connection is welcome
 * to the attribution. A body the user already controls is respected — an
 * existing `metadata` or a non-object `CLAUDE_CODE_EXTRA_BODY` is left alone
 * rather than overwritten.
 */

import type { HarnessId } from '@/shared/lib/harness/catalog';

/** Anthropic's own host. Everything else under `ANTHROPIC_BASE_URL` is a gateway. */
const ANTHROPIC_HOST = 'api.anthropic.com';

/** The env a spawn should use, with the gateway compatibility applied. */
export function withGatewayCompatibility(
  harness: HarnessId,
  env: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (harness !== 'claude' || !env) return env;
  const baseUrl = env.ANTHROPIC_BASE_URL?.trim();
  if (!baseUrl) return env;
  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    // A malformed URL is already a spawn failure the agent reports; guessing
    // at its meaning here would only hide that message.
    return env;
  }
  if (host === ANTHROPIC_HOST) return env;

  let extra: Record<string, unknown> = {};
  const existing = env.CLAUDE_CODE_EXTRA_BODY?.trim();
  if (existing) {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return env;
      // The user's own metadata is deliberate; an empty object is the only
      // value this module may substitute.
      if ('metadata' in parsed) return env;
      extra = parsed as Record<string, unknown>;
    } catch {
      // Not JSON: the agent would ignore it, and replacing it would discard a
      // value the user is still editing.
      return env;
    }
  }
  return { ...env, CLAUDE_CODE_EXTRA_BODY: JSON.stringify({ ...extra, metadata: {} }) };
}
