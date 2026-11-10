/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One POST of a mode command, and the answer as a value.
 *
 * Extracted because two callers now send these: the composer's toggles (to the
 * session on screen) and the goal spawner (to the session a spawn just
 * answered with, BEFORE the URL has moved to it). Both need the same three
 * outcomes — accepted, refused with the server's sentence, or refused by the
 * transport — and a second copy of that `fetch` is how one of them ends up
 * reporting a refusal as success.
 */

import { MODE_COMMAND_TYPE } from '@/shared/lib/omp/mode/types';

export interface ModeCommandResult {
  ok: boolean;
  error?: string;
}

/** POST `type: 'kabmo_mode'` for `sessionId`. A non-2xx answer carries the
 *  route's own reason (`error`), which is the text the composer shows. */
export async function postModeCommand(
  sessionId: string,
  scope: 'plan' | 'goal',
  action: string,
  payload?: Record<string, unknown>,
): Promise<ModeCommandResult> {
  return postAgentCommand(sessionId, { type: MODE_COMMAND_TYPE, scope, action, ...(payload ? { payload } : {}) });
}

/** POST the agent's own `set_mode` command (an ACP mode selector value). */
export async function postSessionMode(sessionId: string, mode: string): Promise<ModeCommandResult> {
  return postAgentCommand(sessionId, { type: 'set_mode', mode });
}

async function postAgentCommand(
  sessionId: string,
  body: Record<string, unknown>,
): Promise<ModeCommandResult> {
  try {
    const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const answer = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: answer.error ?? 'Mode command failed' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Mode command failed' };
  }
}
