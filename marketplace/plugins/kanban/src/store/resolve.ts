/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which agent a card runs on, and why.
 *
 * The chain is per FIELD, first non-null wins:
 *
 *   card.task.agent → stage.agent → board.defaults → host default
 *
 * Per field, not per level: a card that only wants a higher thinking level must
 * not have to restate the stage's harness, and a stage that changes the harness
 * must not silently keep the previous stage's model. `origin` is returned with
 * every value because the sheet renders "stage: in_progress" beside an inherited
 * pick — an override has to be visible before it is made.
 *
 * The host defaults are not invented here: `omp-rpc` is the catalog's default
 * harness, the model is what `/api/agent/new` resolves when the request names
 * none (project default, then the composer's persisted pick), and the access mode
 * is the persisted approval mode. This function therefore returns `null` for
 * those fields and lets the route decide, rather than freezing a copy of a rule
 * the host owns.
 */

import type { AgentOrigin, AgentSpec, Board, Card, ResolvedAgent, Stage } from '../protocol';

/** The host's defaults, named once so the panel and the request agree. */
export const HOST_DEFAULTS = {
  harness: 'omp-rpc',
  access: 'always-ask',
} as const;

function pick<T>(
  levels: readonly { origin: AgentOrigin; value: T | null | undefined }[],
): { value: T | null; origin: AgentOrigin } {
  for (const level of levels) {
    if (level.value !== undefined && level.value !== null) return { value: level.value, origin: level.origin };
  }
  const last = levels[levels.length - 1];
  return { value: null, origin: last?.origin ?? 'host' };
}

/**
 * Resolve one card's agent.
 *
 * `stage` may be undefined for a card whose status matches no stage (an
 * "Unplaced" card): its own task settings still apply, and the board defaults
 * fill the rest, so an orphaned card is still startable rather than stuck.
 */
export function resolveAgent(card: Card, stage: Stage | undefined, board: Board): ResolvedAgent {
  const cardSpec: AgentSpec = card.task.agent ?? {};
  const stageSpec: AgentSpec = stage?.agent ?? {};
  const defaults: AgentSpec = board.defaults ?? {};

  const harness = pick<string>([
    { origin: 'card', value: cardSpec.harness },
    { origin: 'stage', value: stageSpec.harness },
    { origin: 'defaults', value: defaults.harness },
    { origin: 'host', value: HOST_DEFAULTS.harness },
  ]);
  const model = pick<{ provider: string; modelId: string }>([
    { origin: 'card', value: cardSpec.model },
    { origin: 'stage', value: stageSpec.model },
    { origin: 'defaults', value: defaults.model },
    { origin: 'host', value: null },
  ]);
  const thinking = pick<string>([
    { origin: 'card', value: cardSpec.thinking },
    { origin: 'stage', value: stageSpec.thinking },
    { origin: 'defaults', value: defaults.thinking },
    { origin: 'host', value: null },
  ]);
  const access = pick<string>([
    { origin: 'card', value: cardSpec.access },
    { origin: 'stage', value: stageSpec.access },
    { origin: 'defaults', value: defaults.access },
    { origin: 'host', value: HOST_DEFAULTS.access },
  ]);
  const prompt = pick<string>([
    { origin: 'card', value: cardSpec.prompt },
    { origin: 'stage', value: stageSpec.prompt },
    { origin: 'defaults', value: defaults.prompt },
    { origin: 'host', value: '' },
  ]);
  const skills = pick<string[]>([
    { origin: 'card', value: cardSpec.skills },
    { origin: 'stage', value: stageSpec.skills },
    { origin: 'defaults', value: defaults.skills },
    { origin: 'host', value: [] },
  ]);

  const resolvedHarness = harness.value ?? HOST_DEFAULTS.harness;
  return {
    harness: resolvedHarness,
    model: model.value,
    thinking: thinking.value,
    access: access.value ?? HOST_DEFAULTS.access,
    prompt: prompt.value ?? '',
    skills: skills.value ?? [],
    origin: {
      harness: harness.origin,
      model: model.origin,
      thinking: thinking.origin,
      access: access.origin,
      prompt: prompt.origin,
      skills: skills.origin,
    },
    // omp takes a real system prompt at spawn; ACP's `session/new` has no such
    // field, so the same text rides the first turn instead. The sheet says which.
    promptDelivery: resolvedHarness === 'omp-rpc' ? 'appended' : 'prepended',
  };
}

/**
 * The two texts a start sends.
 *
 * On omp-rpc the stage prompt is a spawn flag and the message is the task alone;
 * on ACP the message carries both, fenced so an agent can tell instructions from
 * the task it was given.
 */
export function dispatchText(resolved: ResolvedAgent, taskPrompt: string): {
  systemPrompt: string | undefined;
  message: string;
} {
  if (!resolved.prompt) return { systemPrompt: undefined, message: taskPrompt };
  if (resolved.promptDelivery === 'appended') {
    return { systemPrompt: resolved.prompt, message: taskPrompt };
  }
  return {
    systemPrompt: undefined,
    message: `<stage_instructions>\n${resolved.prompt}\n</stage_instructions>\n\n${taskPrompt}`,
  };
}
