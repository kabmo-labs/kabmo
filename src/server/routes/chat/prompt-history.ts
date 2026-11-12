/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * GET /api/chat/prompt-history — the composer's ArrowUp recall list.
 *
 * `?sessionId=` scopes it to one chat; without it the answer is the merged
 * list across every session, which is what a pending `new-…` chat shows.
 * Newest first, deduplicated, capped (see `PROMPT_HISTORY_LIMIT`).
 */

import { json } from '@/server/lib/remix-compat';
import type { LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { listPrompts } from '@/server/lib/chat/prompt-history.server';
import { PROMPT_HISTORY_LIMIT } from '@/server/lib/chat/schema.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');
  const requested = Number(url.searchParams.get('limit') ?? PROMPT_HISTORY_LIMIT);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), PROMPT_HISTORY_LIMIT)
    : PROMPT_HISTORY_LIMIT;
  try {
    return json({ prompts: await listPrompts(sessionId, limit) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
