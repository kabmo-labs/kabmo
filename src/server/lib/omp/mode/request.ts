/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Kabmo's plan/goal control channel.
 *
 * Every mode action is an ordinary `/kabmo-mode <scope> <action> [json]`
 * prompt sent to the live child, where Kabmo-owned extension executes it
 * locally. Three properties make that the right transport, and all three are
 * measured rather than assumed:
 *
 *  - it reaches the live `AgentSession`, which no RPC verb does for either
 *    mode;
 *  - it costs no transcript: the command answers `agentInvoked: false` and
 *    writes no user message, so toggling Plan five times leaves no bubbles;
 *  - it needs no respawn. The extension re-applies both flags in-process, so a
 *    live session is re-targeted instantly — unlike `--approval-mode`, which is
 *    a spawn-time flag and forces the destroy-and-respawn dance.
 *
 * The payload is JSON because an objective is free-form text: spaces,
 * punctuation and newlines all have to survive one line of prompt.
 */

import { isRecord } from '@/shared/lib/util/guards';
import { KABMO_MODE_COMMAND, type KabmoModeSelection } from '@/shared/lib/omp/mode/types';

export type ModeScope = 'plan' | 'goal';

export interface ModeRequest {
  scope: ModeScope;
  action: string;
  payload?: Record<string, unknown>;
}

/** The command type a mode request travels as.
 *
 *  `kabmo_mode` is what this build sends; `chamber_mode` is the pre-rename
 *  spelling and is still ACCEPTED, because a tab that loaded before a restart
 *  keeps posting the old name until it reloads, and a rejected request there
 *  reads as a dead Plan/Goal button. */
export const MODE_COMMAND_TYPE = 'kabmo_mode';

/** @deprecated Use `MODE_COMMAND_TYPE`. Accepted on the read side. */
export const LEGACY_MODE_COMMAND_TYPE = 'chamber_mode';

/** Whether a command body's `type` names a mode request, under either spelling. */
export function isModeCommandType(type: unknown): boolean {
  return type === MODE_COMMAND_TYPE || type === LEGACY_MODE_COMMAND_TYPE;
}

/** Parse a mode request body. Returns null when the shape is wrong,
 *  so the route answers a 400 instead of forwarding a command the extension
 *  would reject with a notice. */
export function parseModeRequest(body: Record<string, unknown>): ModeRequest | null {
  const scope = body.scope;
  const action = body.action;
  if (scope !== 'plan' && scope !== 'goal') return null;
  if (typeof action !== 'string' || !action.trim()) return null;
  const payload = isRecord(body.payload) ? body.payload : undefined;
  return { scope, action: action.trim(), payload };
}

/** Render the prompt that carries a mode request to the extension.
 *
 *  One line, always: the command token ends at the first whitespace run, and a
 *  newline inside the JSON would end the prompt's argument region instead of
 *  the string it belongs to. `JSON.stringify` escapes newlines, which is the
 *  whole reason the payload is JSON rather than `key=value` pairs. */
export function modeCommandPrompt(request: ModeRequest): string {
  const payload = request.payload && Object.keys(request.payload).length > 0 ? ` ${JSON.stringify(request.payload)}` : '';
  return `/${KABMO_MODE_COMMAND} ${request.scope} ${request.action}${payload}`;
}

/** A selection parsed from a client request body. Absent flags mean "off", so
 *  a partial body can never silently leave a mode on. */
export function parseModeSelection(body: Record<string, unknown>): KabmoModeSelection {
  return { plan: body.plan === true, goal: body.goal === true };
}

/** The extension's mode-selection env value for a selection. */
export function modeEnvValue(selection: KabmoModeSelection): string {
  return [selection.plan ? 'plan' : '', selection.goal ? 'goal' : ''].filter(Boolean).join(',');
}

/** The selection a mode-selection env value describes — the inverse of
 *  `modeEnvValue`, kept beside it so the two spellings of the format cannot
 *  drift. An absent or empty value is the empty selection, which is what a
 *  prewarmed child carries. */
export function selectionFromModeEnvValue(value: string | undefined): KabmoModeSelection {
  const parts = (value ?? '').split(',');
  return { plan: parts.includes('plan'), goal: parts.includes('goal') };
}
