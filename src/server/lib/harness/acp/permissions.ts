/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The approval queue of one ACP session.
 *
 * `session/request_permission` BLOCKS the agent's turn until it is answered, so
 * this is not bookkeeping — it is the thing that keeps a turn alive across a tab
 * reload. Two measured rules:
 *
 *  - the dialog id IS the JSON-RPC id, because the answer arrives later through
 *    `extension_ui_response` and has to name the exact parked call;
 *  - a dismissed dialog answers `cancelled`. Sending nothing leaves the agent
 *    waiting forever, and sending a refusal after the client already chose would
 *    be a second answer to one request.
 */

import type { AcpId } from '@kabmo-labs/kabmo-acp-protocol/protocol';
import type { ApprovalMode } from '@kabmo-labs/kabmo-omp-access-mode';
import { PermissionGrants } from '@/server/lib/harness/acp/grants';

export interface PermissionOption {
  optionId: string;
  name?: string;
  kind?: string;
}

export interface PendingPermission {
  /** JSON-RPC id of the agent's request; the dialog id is its string form. */
  id: AcpId;
  requestId: string;
  sessionId: string;
  toolCall?: Record<string, unknown>;
  options: PermissionOption[];
}

/** What `extension_ui_request` carries for one pending approval.
 *
 *  `options`/`optionIds` are parallel arrays: the client draws the labels and
 *  answers with the id, so "Always allow" is a decision it can actually make.
 *  The labels alone cannot name an option — two may read alike, and omp frames
 *  that have no ids (every non-ACP producer) stay a yes/no confirm. */
export interface PermissionDialog {
  type: 'extension_ui_request';
  id: string;
  method: 'confirm';
  title: string;
  message: string;
  options: string[];
  optionIds: string[];
}

/** One dialog, from the request it parks. Shared by `add` and the replay so a
 *  reattaching client sees exactly what the live one did. */
function dialogFor(entry: PendingPermission): PermissionDialog {
  return {
    type: 'extension_ui_request',
    id: entry.requestId,
    method: 'confirm',
    title: typeof entry.toolCall?.title === 'string' ? entry.toolCall.title : 'Approve this action',
    message: describePermission(entry.toolCall),
    options: entry.options.map((option) => option.name ?? option.optionId),
    optionIds: entry.options.map((option) => option.optionId),
  };
}

export class PendingPermissions {
  private readonly entries: PendingPermission[] = [];
  /** Standing "always allow" decisions, keyed by the call the dialog showed. */
  readonly grants = new PermissionGrants();

  /** Register one agent request and describe the dialog the client must draw. */
  add(id: AcpId, sessionId: string, params: Record<string, unknown>): PermissionDialog {
    const toolCall = params.toolCall && typeof params.toolCall === 'object'
      ? Object.fromEntries(Object.entries(params.toolCall))
      : undefined;
    const entry: PendingPermission = {
      id,
      requestId: String(id),
      sessionId,
      toolCall,
      options: Array.isArray(params.options) ? (params.options as PermissionOption[]) : [],
    };
    this.entries.push(entry);
    return dialogFor(entry);
  }

  /** Every dialog still waiting — a reattaching client replays these. */
  pendingDialogs(): PermissionDialog[] {
    return this.entries.map(dialogFor);
  }

  /** The entry a dialog id names, removing it so one request is answered once. */
  take(dialogId: string): PendingPermission | undefined {
    const index = this.entries.findIndex((entry) => entry.requestId === dialogId);
    if (index === -1) return undefined;
    return this.entries.splice(index, 1)[0];
  }

  /** The option a decision maps to, IN THAT DIRECTION ONLY.
   *
   *  The previous fallback (`options[0]` for confirm, the last option for deny)
   *  guessed from POSITION, and an agent whose list ran `[reject_once, …]` made
   *  Confirm reject while a dismissed dialog ("Esc") selected an `allow_*` that
   *  happened to be last. Undefined is the honest answer when the agent offered
   *  no option pointing the way the operator chose; the caller answers
   *  `cancelled`. */
  optionFor(entry: PendingPermission, confirmed: boolean): PermissionOption | undefined {
    const kinds = confirmed ? ['allow_once', 'allow_always'] : ['reject_once', 'reject_always'];
    for (const kind of kinds) {
      const found = entry.options.find((option) => option.kind === kind);
      if (found) return found;
    }
    return undefined;
  }

  clear(): void {
    this.entries.length = 0;
  }

  /** Remove and return every pending request, for a caller that must answer
   *  each one (a cancelled turn answers them all with `cancelled`). */
  drain(): PendingPermission[] {
    return this.entries.splice(0, this.entries.length);
  }

  size(): number {
    return this.entries.length;
  }
}

/** What the approval dialog says, from the tool call the agent reported. */
export function describePermission(toolCall: Record<string, unknown> | undefined): string {
  const rawInput = toolCall?.rawInput;
  if (rawInput && typeof rawInput === 'object' && 'command' in rawInput && typeof rawInput.command === 'string') {
    return `$ ${rawInput.command}`;
  }
  const title = toolCall?.title;
  return typeof title === 'string' ? title : 'This action needs your approval';
}

/** ACP tool kinds that cannot change the workspace. */
const READ_KINDS: Record<string, true> = { read: true, search: true, fetch: true, think: true, switch_mode: true };

/** ACP tool kinds that write to the workspace. */
const WRITE_KINDS: Record<string, true> = { edit: true, delete: true, move: true };

/**
 * Whether `mode` answers this permission request without asking the user.
 *
 * The mapping is omp's own contract, so one label means one thing on both
 * transports: `always-ask` auto-runs read-tier tools and asks for write+exec,
 * `write` auto-runs read+write and asks for exec, `yolo` runs everything.
 * ACP publishes the tier as `toolCall.kind`, so nothing is guessed from a title.
 */
export function autoApproval(mode: ApprovalMode, toolCall: Record<string, unknown> | undefined): boolean {
  if (mode === 'yolo') return true;
  const kind = typeof toolCall?.kind === 'string' ? toolCall.kind : 'other';
  if (READ_KINDS[kind]) return true;
  if (mode === 'write') return WRITE_KINDS[kind] === true;
  return false;
}

/** The `allow_*` option id an auto-approval selects, or null when the agent
 *  offered none — a request with no allow option still has to reach the user.
 *  `prefer: 'always'` is used for a GRANTED call, where the standing decision
 *  is exactly "always" and no dialog will follow. */
export function allowOption(
  options: readonly PermissionOption[],
  prefer: 'once' | 'always' = 'once',
): string | null {
  const kinds = prefer === 'always' ? ['allow_always', 'allow_once'] : ['allow_once', 'allow_always'];
  for (const kind of kinds) {
    const found = options.find((entry) => entry.kind === kind);
    if (found) return found.optionId;
  }
  const any = options.find((entry) => typeof entry.kind === 'string' && entry.kind.startsWith('allow_'));
  return any?.optionId ?? null;
}
