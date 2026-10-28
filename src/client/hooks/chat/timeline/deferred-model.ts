/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Composer model/thinking picks that must NOT reach the live session yet.
 *
 * omp applies `set_model` / `set_thinking_level` to the RUNNING turn: the next
 * LLM call inside the stream (the one after a tool result) goes out on the new
 * model, so a pick made while an answer streams visibly re-targets that answer
 * mid-flight. A composer pick is intent for the NEXT prompt, so while a turn is
 * running it is stashed here and pushed to the session right before the next
 * prompt the composer starts (plain send, steer, or queued delivery).
 *
 * The slot holds only what has NOT reached the session yet, so a pick applied
 * directly (idle composer) clears exactly the fields it applied — a stashed
 * thinking level survives a later model change instead of being resurrected
 * over it.
 *
 * Verified against omp's RPC handler: `set_model` resolves the model and calls
 * the session's `setModel` immediately — nothing defers it to a turn boundary.
 */

import type { OmpAgentHandle } from '@/shared/types';

/** Fields a composer pick can carry; each handler owns its own. */
export interface ComposerModelPick {
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
}

/** Mutable slot the timeline hook owns; the composer and send paths share it. */
export interface DeferredModelStore {
  current: ComposerModelPick | null;
}

/**
 * Slot that never holds a pick, for composers with no stream to defer against
 * (the New Chat modal): every guard reads it as "nothing pending", so their
 * adoption behaviour stays exactly as it was.
 */
export const NO_PENDING_PICK: DeferredModelStore = { current: null };

/** A pick that names a model must name both halves of it. */
function hasModel(pick: ComposerModelPick): pick is ComposerModelPick & { provider: string; modelId: string } {
  return Boolean(pick.provider && pick.modelId);
}

/**
 * Record a pick made while a turn is streaming. Merged over the previous stash
 * so a model pick and a later thinking pick both survive to the next prompt.
 */
export function stashComposerPick(store: DeferredModelStore, pick: ComposerModelPick): void {
  store.current = { ...store.current, ...pick };
}

/**
 * Drop the fields a pick just applied directly, keeping any still-pending ones.
 * Without this, a stashed pick would be flushed over the newer selection on the
 * next send and silently revert the user's latest choice.
 */
export function consumeComposerPick(store: DeferredModelStore, pick: ComposerModelPick): void {
  const pending = store.current;
  if (!pending) return;
  const next: ComposerModelPick = { ...pending };
  if (pick.provider || pick.modelId) {
    delete next.provider;
    delete next.modelId;
  }
  if (pick.thinkingLevel) delete next.thinkingLevel;
  store.current = next.provider || next.modelId || next.thinkingLevel ? next : null;
}

/**
 * Push a pick onto the live session. `thinkingLevel: 'auto'` means "leave omp's
 * level alone" — the same rule the send path applies — so it is skipped rather
 * than translated into a concrete level.
 */
export async function applyComposerPick(agent: OmpAgentHandle, pick: ComposerModelPick): Promise<void> {
  if (hasModel(pick)) await agent.setModel(pick.provider, pick.modelId);
  if (pick.thinkingLevel && pick.thinkingLevel !== 'auto') await agent.setThinkingLevel(pick.thinkingLevel);
}

/** Push the stashed pick (if any) onto the session and clear the slot. */
export async function flushDeferredPick(agent: OmpAgentHandle, store: DeferredModelStore): Promise<void> {
  const pick = store.current;
  if (!pick) return;
  store.current = null;
  await applyComposerPick(agent, pick);
}
