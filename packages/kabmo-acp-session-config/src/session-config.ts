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
 * A harness that answers with no list is the exception: the write succeeded, so
 * the requested value is adopted and a later `config_option_update` corrects it.
 * Leaving the session on its `session/new` model made the footer and the sidebar
 * row name the first model the chat ever picked for the rest of its life.
 *
 * ## Why every approval exit answers
 *
 * The agent is PARKED on `session/request_permission` until it hears back: a
 * chosen option becomes `{outcome:"selected"}`, and a dialog id nobody knows
 * becomes `cancelled`. Returning silently would hang the turn — the failure this
 * module exists to make impossible.
 */

import { configOption, modelFromOption } from '@kabmo-labs/kabmo-acp-prompt/prompt';
import { isDurableGrantKey, permissionGrantKey } from '@kabmo-labs/kabmo-acp-client/grants';
import type { AcpConfigOption, AcpSessionModeState, AcpSessionModels } from '@kabmo-labs/kabmo-acp-protocol/protocol';
import type { PendingPermissions } from '@kabmo-labs/kabmo-acp-client/permissions';
import type { HarnessId } from '@kabmo-labs/kabmo-harness-catalog';
import type { AgentEvent } from '@kabmo-labs/kabmo-omp-rpc-protocol/constants';

/** The fields a config answer rewrites. */
export interface AcpConfigTarget {
  readonly harness: HarnessId;
  configOptions: AcpConfigOption[];
  runModel: { provider: string; modelId: string } | null;
}

/** The target plus what publishing a change needs: a live run row to rename and
 *  a frame stream the client folds. */
export interface AcpConfigNotice extends AcpConfigTarget {
  readonly sessionId: string;
  readonly isStreaming: boolean;
  emit(event: Record<string, unknown> & { type: string }): void;
}

/** Write the agent's COMPLETE config list into the session. */
export function adoptConfigList(target: AcpConfigTarget, options: AcpConfigOption[]): void {
  target.configOptions = options;
  const resolved = modelFromOption(configOption(options, 'model'), target.harness);
  if (resolved) target.runModel = resolved;
}

/** Adopt `session/set_config_option`'s reply when it carries a config list. */
export function adoptConfigOptions(target: AcpConfigTarget, result: unknown): boolean {
  if (!result || typeof result !== 'object' || !('configOptions' in result) || !Array.isArray(result.configOptions)) {
    return false;
  }
  adoptConfigList(target, result.configOptions as AcpConfigOption[]);
  return true;
}

/**
 * Adopt a config WRITE even when the agent omitted the reply list.
 *
 * The protocol says the reply MUST carry the complete list, and every measured
 * adapter does — but a harness that answers `{}` left the session naming the
 * model from `session/new`, so the run footer and the sidebar row reported the
 * first model the chat ever picked for the rest of its life. The write itself
 * succeeded, so the requested value is the best state we have; a later
 * `config_option_update` (or the next reply) replaces it with the agent's own.
 */
export function adoptConfigAnswer(
  target: AcpConfigTarget,
  result: unknown,
  requested: { configId: string; value: string | boolean },
): void {
  if (adoptConfigOptions(target, result)) return;
  if (!target.configOptions.some((option) => option.id === requested.configId)) return;
  adoptConfigList(
    target,
    target.configOptions.map((option) =>
      option.id === requested.configId ? { ...option, currentValue: requested.value } : option,
    ),
  );
}

/**
 * Announce a written config option on the session's own frame stream — the
 * vocabulary omp already uses, so the client's existing `model_changed`
 * handler refreshes the session metadata (and thus the footer/composer) with
 * no second path. A live run row is renamed here too: a `set_model` can land
 * while a turn is streaming, and the sidebar/indicator read that row, not
 * `get_state`.
 */
export function publishConfigChange(target: AcpConfigNotice, configId: string | undefined, effects: AcpConfigEffects): void {
  if (target.runModel && target.isStreaming) {
    void effects.markStreamModel(target.sessionId, target.runModel).catch(() => {});
  }
  const written = configId ? target.configOptions.find((option) => option.id === configId) : null;
  // No id means the agent pushed a fresh list (`config_option_update`): any of
  // its selectors may have moved, so name both known identities.
  if (!written || written.category === 'model') {
    if (target.runModel) target.emit({ type: 'model_changed' });
  }
  const thinking = configOption(target.configOptions, 'thought_level');
  if ((!written || written.category === 'thought_level') && typeof thinking?.currentValue === 'string') {
    target.emit({ type: 'thinking_level_changed', thinkingLevel: thinking.currentValue });
  }
}

/** The model fields the footer/indicator read, or the frame unchanged. */
export function stampMessageModel(event: AgentEvent, model: { provider: string; modelId: string } | null): AgentEvent {
  if (!model) return event;
  if (event.type !== 'message_update' && event.type !== 'message_end') return event;
  if (!event.message || typeof event.message !== 'object') return event;
  return {
    ...event,
    message: { ...event.message, model: model.modelId, provider: model.provider },
  };
}

/** The outside effects a config answer needs. Injected so this package stays
 *  free of the database (grants) and the live run row (stream state). */
export interface AcpConfigEffects {
  /** Persist a standing approval for the session; resolves when stored. */
  saveGrant(sessionId: string, grantKey: string): Promise<void>;
  /** Rename the live run row a streaming `set_model` landed under. */
  markStreamModel(sessionId: string, model: { provider: string; modelId: string }): Promise<void>;
}

/** The process slice answering a dialog needs; `AcpProcess` satisfies it. */
export interface AcpResponder {
  respond(id: string | number, result: unknown): void;
}

/** Answer one parked approval dialog.
 *
 *  `optionId` is the option the operator actually CLICKED (the dialog renders
 *  the agent's list); `confirmed` is the fallback for a yes/no frame. An id the
 *  dialog does not hold is ignored rather than guessed — it belongs to a frame
 *  that was withdrawn, and selecting a different option there would approve
 *  something the operator never saw.
 *
 *  Returns the grant key when the chosen option was `allow_always`, so the
 *  caller can persist the standing decision. */
export function settlePermissionDialog(
  permissions: PendingPermissions,
  responder: AcpResponder,
  dialogId: string,
  choice: { confirmed: boolean; optionId?: string; grantSessionId?: string },
  effects: AcpConfigEffects,
): string | null {
  const entry = permissions.take(dialogId);
  if (!entry) return null;
  const picked = (choice.optionId
    ? entry.options.find((option) => option.optionId === choice.optionId)
    : undefined) ?? permissions.optionFor(entry, choice.confirmed);
  if (!picked) {
    responder.respond(entry.id, { outcome: { outcome: 'cancelled' } });
    return null;
  }
  responder.respond(entry.id, { outcome: { outcome: 'selected', optionId: picked.optionId } });
  if (picked.kind !== 'allow_always') return null;
  const key = permissionGrantKey(entry.toolCall);
  if (!permissions.grants.add(key)) return null;
  // Persisted only for a key with a real identity: a title-only grant would
  // approve unrelated calls on the next spawn. It still holds for this session.
  const grantSession = choice.grantSessionId ?? entry.sessionId;
  if (key !== null && grantSession && isDurableGrantKey(key)) {
    void effects.saveGrant(grantSession, key).catch(() => {});
  }
  return key;
}

/** The process slice a config write drives; `AcpProcess` satisfies it. */
export interface AcpConfigWriter extends AcpConfigNotice {
  modes: AcpSessionModeState | null;
  /** The `models` block, for an agent with no `model` selector. */
  models?: AcpSessionModels | null;
  writeConfigOption(configId: string, value: string | boolean): Promise<unknown>;
  writeMode(modeId: string): Promise<unknown>;
  /** `session/set_model`: the only way to select a model on an agent that
   *  publishes a `models` block instead of a config option. */
  writeModel?: (modelId: string) => Promise<unknown>;
}

/**
 * Write one config selector and adopt the agent's answer.
 *
 * The synthesized `mode` selector an agent that speaks only `modes` publishes
 * has no config option to write, so that one value goes through `session/set_mode`.
 */
export async function setAcpConfig(
  target: AcpConfigWriter,
  configId: string,
  value: string | boolean,
  effects: AcpConfigEffects,
): Promise<unknown> {
  if (configId === 'mode' && typeof value === 'string' && !target.configOptions.some((option) => option.id === 'mode') && target.modes) {
    return setAcpMode(target, value);
  }
  // The synthesized selector from a `models` block is answered by
  // `session/set_model`: the agent never published a `model` config option, so a
  // `set_config_option` would ask it for a selector it does not have.
  const synthesized = configId === 'model'
    && typeof value === 'string'
    && target.models !== undefined
    && target.models !== null;
  if (synthesized && target.writeModel) {
    const result = await target.writeModel(value);
    target.models = { ...target.models, currentModelId: value };
    adoptConfigAnswer(target, result, { configId, value });
    publishConfigChange(target, configId, effects);
    return result;
  }
  const result = await target.writeConfigOption(configId, value);
  adoptConfigAnswer(target, result, { configId, value });
  publishConfigChange(target, configId, effects);
  return result;
}

/** `session/set_mode`: the pre-config-options way to move a mode. */
export async function setAcpMode(target: AcpConfigWriter, modeId: string): Promise<unknown> {
  const result = await target.writeMode(modeId);
  if (target.modes) target.modes = { ...target.modes, currentModeId: modeId };
  target.emit({ type: 'mode_changed', modeId });
  return result;
}
