/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which CONFIGURATION fields a given harness can actually use.
 *
 * The card drew the same six fields for every agent, and two of them were lies on
 * most of them. Measured on this machine:
 *
 * | Harness | `probe.models` values | Providers |
 * |---|---|---|
 * | `omp-acp` | `kenari/claude-sonnet-5`, … (221) | `kenari`, `kenari-jatis`, `aihub-brisnets-jatis` |
 * | `claude` | `default`, `opus`, `sonnet`, `haiku`, `claude-fable-5[1m]` | **none** |
 * | `codex` (unauthenticated) | none published | none |
 *
 * So `claude` got a "Provider" field that could never fill and a model list that
 * never narrowed by it — while its real provider switch is `ANTHROPIC_BASE_URL` in
 * the Environment box, which was hinted with `GEMINI_API_KEY` examples.
 *
 * This module answers, per harness and per probe:
 *
 *  - is there a PROVIDER dimension at all (only for `provider/model` selectors)?
 *  - does the agent publish a model list, a thinking ladder, a mode selector?
 *  - what does its Environment box actually carry?
 *
 * Pure and probe-injected: the form renders exactly this, and a test pins it
 * without spawning an agent.
 */

import type { HarnessId } from '@/shared/lib/harness/catalog';
import { providerFacts } from '@/shared/lib/harness/provider-facts';

/** The probe fields this plan reads. Absent means "never probed". */
export interface ConfigProbeFacts {
  models?: readonly { value: string }[];
  thinking?: readonly { value: string }[];
  modes?: readonly { value: string }[];
}

export interface ConfigFieldPlan {
  /** True only when the agent publishes `provider/model` selectors. */
  showProvider: boolean;
  showModel: boolean;
  showThinking: boolean;
  showMode: boolean;
  /**
   * True when the model values already name a provider, so choosing one is the
   * whole decision and a separate Provider field would only filter it.
   */
  modelsAreSelectors: boolean;
  /** The variable names this agent's Environment box actually carries. */
  envHint: string;
  envPlaceholder: string;
  /** What to type in the launch box when empty, from the build's own table. */
  launchPlaceholder: string;
  /** Per-harness guidance the generic form cannot know. */
  notes: string[];
}

/** Providers the probe's model list names, in its own order. */
function providersOf(models: readonly { value: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const option of models) {
    const slash = option.value.indexOf('/');
    if (slash <= 0) continue;
    const provider = option.value.slice(0, slash);
    if (seen.has(provider)) continue;
    seen.add(provider);
    out.push(provider);
  }
  return out;
}

/**
 * The Environment box, described by the agent's OWN contract.
 *
 * `providerFacts(id).env` exists only where the vendor documents environment
 * variables as the provider switch (Claude Code, Antigravity). Every other agent
 * reads a registry file instead, and its env box carries the credential the file
 * NAMES (`OPENAI_API_KEY` for codex, `GEMINI_API_KEY` for Antigravity).
 */
function environmentFacts(id: HarnessId): { hint: string; placeholder: string; notes: string[] } {
  const facts = providerFacts(id);
  if (facts.env) {
    const names = [facts.env.baseUrl, facts.env.apiKey, facts.env.model].filter(Boolean).join(', ');
    return {
      hint: `The variables that point this agent at one endpoint: ${names}. Setting them REPLACES its own provider.`,
      placeholder: `${facts.env.baseUrl}=https://…\n${facts.env.apiKey}=…`,
      notes: ['This agent has no provider registry — a provider here is an endpoint and a key, nothing else.'],
    };
  }
  if (facts.registry.kind === 'none') {
    return {
      hint: 'One KEY=VALUE per line. Nothing else configures a provider for this agent.',
      placeholder: 'KEY=VALUE',
      notes: ['No provider registry and no provider variables: the launch line and this box are the whole surface.'],
    };
  }
  if (facts.registry.kind === 'agent-managed') {
    return {
      hint: 'One KEY=VALUE per line. Providers themselves are managed by the agent’s own command.',
      placeholder: 'KEY=VALUE',
      notes: ['The provider registry belongs to the agent — add providers with its own command.'],
    };
  }
  return {
    hint: `Credentials this agent reads from the environment. Its providers live in ${facts.registry.file ?? 'its own config'}.`,
    placeholder: 'KEY=VALUE',
    notes: [`Providers are edited in ${facts.registry.file ?? 'the agent’s own config'}, not here.`],
  };
}

/**
 * The plan for one harness.
 *
 * `provider` is the CURRENT config value: a provider already stored stays
 * editable even when the probe has not run, because hiding a stored value is how
 * a form silently rewrites what it cannot show.
 */
export function configFieldPlan(
  id: HarnessId,
  probe: ConfigProbeFacts | undefined,
  options: { provider?: string; launchCommand?: string } = {},
): ConfigFieldPlan {
  const models = probe?.models ?? [];
  const providers = providersOf(models);
  const env = environmentFacts(id);
  // `provider/model` selectors are the ONE shape that gives "Provider" a meaning.
  // Every other agent publishes bare names, and filtering those by a provider
  // that does not exist left the field permanently empty.
  const modelsAreSelectors = providers.length > 0;
  const storedProvider = Boolean(options.provider?.trim());

  return {
    showProvider: modelsAreSelectors || storedProvider,
    showModel: true,
    showThinking: Boolean(probe?.thinking?.length),
    showMode: Boolean(probe?.modes?.length),
    modelsAreSelectors,
    envHint: env.hint,
    envPlaceholder: env.placeholder,
    launchPlaceholder: options.launchCommand ?? 'the agent’s own command',
    notes: env.notes,
  };
}

/** True when the agent published anything the provider field could list. */
export function providerOptions(probe: ConfigProbeFacts | undefined): string[] {
  return providersOf(probe?.models ?? []);
}
