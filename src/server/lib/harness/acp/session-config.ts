/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two config/approval writes an ACP session makes on someone else's behalf,
 * split out of the session because neither needs its state: one adopts the
 * agent's answer to a config write, the other answers a parked approval dialog.
 *
 * ## Why the config answer is adopted rather than assumed
 *
 * `session/set_config_option` replies with the WHOLE config list, and the model
 * selector's `currentValue` is the model the agent RESOLVED — an alias or a
 * fallback can differ from what was asked for. The run indicator names the model
 * from this field, so a session that kept its own request would announce a model
 * the answer did not come from.
 *
 * ## Why every approval exit answers
 *
 * The agent is PARKED on `session/request_permission` until it hears back: a
 * chosen option becomes `{outcome:"selected"}`, and a dialog id nobody knows
 * becomes `cancelled`. Returning silently would hang the turn — the failure this
 * module exists to make impossible.
 */

import { configOption, modelFromOption } from '@/server/lib/harness/acp/prompt';
import type { AcpConfigOption } from '@/server/lib/harness/acp/protocol';
import type { PendingPermissions } from '@/server/lib/harness/acp/permissions';
import type { HarnessId } from '@/shared/lib/harness/catalog';

/** The fields a config answer rewrites. */
export interface AcpConfigTarget {
  readonly harness: HarnessId;
  configOptions: AcpConfigOption[];
  runModel: { provider: string; modelId: string } | null;
}

/** Adopt `session/set_config_option`'s reply, when it carries a config list. */
export function adoptConfigOptions(target: AcpConfigTarget, result: unknown): void {
  if (!result || typeof result !== 'object' || !('configOptions' in result) || !Array.isArray(result.configOptions)) {
    return;
  }
  target.configOptions = result.configOptions as AcpConfigOption[];
  const resolved = modelFromOption(configOption(target.configOptions, 'model'), target.harness);
  if (resolved) target.runModel = resolved;
}

/** The process slice answering a dialog needs; `AcpProcess` satisfies it. */
export interface AcpResponder {
  respond(id: string | number, result: unknown): void;
}

/** Answer one parked approval dialog. Unknown ids are ignored, never guessed. */
export function settlePermissionDialog(
  permissions: PendingPermissions,
  responder: AcpResponder,
  dialogId: string,
  confirmed: boolean,
): void {
  const entry = permissions.take(dialogId);
  if (!entry) return;
  const chosen = permissions.optionFor(entry, confirmed);
  responder.respond(entry.id, {
    outcome: chosen ? { outcome: 'selected', optionId: chosen.optionId } : { outcome: 'cancelled' },
  });
}
