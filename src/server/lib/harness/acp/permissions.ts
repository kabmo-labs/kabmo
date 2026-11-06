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

import type { AcpId } from '@/server/lib/harness/acp/protocol';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';

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

/** What `extension_ui_request` carries for one pending approval. */
export interface PermissionDialog {
  type: 'extension_ui_request';
  id: string;
  method: 'confirm';
  title: string;
  message: string;
  options: { id: string; label: string }[];
}

export class PendingPermissions {
  private readonly entries: PendingPermission[] = [];

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
    return {
      type: 'extension_ui_request',
      id: entry.requestId,
      method: 'confirm',
      title: typeof toolCall?.title === 'string' ? toolCall.title : 'Approve this action',
      message: describePermission(toolCall),
      options: entry.options.map((option) => ({ id: option.optionId, label: option.name ?? option.optionId })),
    };
  }

  /** Every dialog still waiting — a reattaching client replays these. */
  pendingDialogs(): PermissionDialog[] {
    return this.entries.map((entry) => ({
      type: 'extension_ui_request',
      id: entry.requestId,
      method: 'confirm',
      title: typeof entry.toolCall?.title === 'string' ? entry.toolCall.title : 'Approve this action',
      message: describePermission(entry.toolCall),
      options: entry.options.map((option) => ({ id: option.optionId, label: option.name ?? option.optionId })),
    }));
  }

  /** The entry a dialog id names, without removing it. */
  take(dialogId: string): PendingPermission | undefined {
    const index = this.entries.findIndex((entry) => entry.requestId === dialogId);
    if (index === -1) return undefined;
    return this.entries.splice(index, 1)[0];
  }

  /** Answer one dialog through `answer`, or cancel it when it is unknown. */
  resolve(dialogId: string, answer: (dialogId: string, confirmed: boolean) => unknown, confirmed = false): unknown {
    if (!this.entries.some((entry) => entry.requestId === dialogId)) {
      return answer(dialogId, false);
    }
    return answer(dialogId, confirmed);
  }

  /** The option a decision maps to, preferring the exact once-only kind. */
  optionFor(entry: PendingPermission, confirmed: boolean): PermissionOption | undefined {
    return confirmed
      ? entry.options.find((option) => option.kind === 'allow_once') ?? entry.options[0]
      : entry.options.find((option) => option.kind === 'reject_once') ?? entry.options[entry.options.length - 1];
  }

  clear(): void {
    this.entries.length = 0;
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
 *  offered none — a request with no allow option still has to reach the user. */
export function allowOption(options: readonly PermissionOption[]): string | null {
  const option = options.find((entry) => entry.kind === 'allow_once')
    ?? options.find((entry) => typeof entry.kind === 'string' && entry.kind.startsWith('allow_'));
  return option?.optionId ?? null;
}
