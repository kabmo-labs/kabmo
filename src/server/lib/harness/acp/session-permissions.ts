/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The approval gate, split out of the session.
 *
 * `session/request_permission` BLOCKS the agent's turn until it is answered, so
 * the session has exactly two obligations and they are the two functions here:
 * answer a call the operator's tier already allows WITHOUT parking it, and answer
 * every later dialog — a chosen option becomes `{outcome:"selected"}`, and an id
 * nobody knows becomes `cancelled`. A silent return hangs the agent, which is the
 * failure this module exists to make impossible.
 */

import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { allowOption, autoApproval, type PermissionOption } from '@/server/lib/harness/acp/permissions';

/**
 * The option id to select when the tier already allows this call, or null to
 * park it as a dialog.
 *
 * Answered HERE, before a dialog exists: parking it would ask a question the
 * operator's own selection already answered, and `isBusy()` would report a
 * dialog nobody is meant to see.
 */
export function preApprovedOption(
  accessMode: ApprovalMode,
  params: Record<string, unknown>,
): string | null {
  const toolCall = params.toolCall && typeof params.toolCall === 'object'
    ? Object.fromEntries(Object.entries(params.toolCall))
    : undefined;
  if (!autoApproval(accessMode, toolCall)) return null;
  const options = Array.isArray(params.options) ? (params.options as PermissionOption[]) : [];
  return allowOption(options);
}
