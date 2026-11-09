/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `@harness` delegation mentions in the composer.
 *
 * A mention is a commitment, not a suggestion: `@harness:claude` (or bare
 * `@claude`) names the agent that must do the paragraph's work, and the text of
 * that paragraph is its whole brief. The parser turns a message into a
 * delegation plan the orchestrator can execute with the CLI, so the model never
 * has to guess a harness, a model or which words were the task.
 *
 * Namespaced `harness:` cannot collide with `@file:` or an omp `@agent`; a bare
 * `@claude` is accepted only when the token is a known harness id and is not a
 * known agent name.
 */

import { HARNESS_CATALOG, HARNESS_IDS, type HarnessId } from '@/shared/lib/harness/catalog';

export interface HarnessDelegation {
  harness: HarnessId;
  /** The agent's own model value, or null for the harness default. */
  model: string | null;
  task: string;
  /** The exact token the user typed, for diagnostics and display. */
  token: string;
}

export type DelegationErrorCode = 'unknown_harness' | 'empty_task' | 'multiple_mentions';

export interface DelegationError {
  code: DelegationErrorCode;
  message: string;
  paragraph: string;
}

export interface DelegationPlan {
  delegations: HarnessDelegation[];
  /** The paragraphs that stay with the orchestrator, mentions removed. */
  orchestratorText: string;
  errors: DelegationError[];
}

export interface ParseDelegationOptions {
  /** Bare `@name` is an omp agent when it matches one of these. */
  agentNames?: readonly string[];
}

/** `@harness:<id>[:<model>]` or bare `@<harnessId>`. */
const MENTION_RE = /(^|[\s([{])@(?:(harness):)?([a-z0-9][a-z0-9-]*)(?::([^\s#]+))?/gi;

/** The names users type that are not catalog ids. `omp` is the default RPC
 *  surface; `claude-code` is the vendor's name for the `claude` adapter. */
const HARNESS_ALIASES: Readonly<Record<string, HarnessId>> = {
  omp: 'omp-rpc',
  'claude-code': 'claude',
};

function harnessIdFor(name: string): HarnessId | null {
  return HARNESS_ALIASES[name] ?? (HARNESS_IDS.includes(name as HarnessId) ? (name as HarnessId) : null);
}

/**
 * Parse one message. The error list is non-empty when the message cannot be
 * delegated as written; the caller refuses the send rather than guessing.
 */
export function parseHarnessMentions(
  text: string,
  options: ParseDelegationOptions = {},
): DelegationPlan {
  const agentNames = new Set((options.agentNames ?? []).map((name) => name.toLowerCase()));
  const paragraphs = text.split(/\n\s*\n/);
  const delegations: HarnessDelegation[] = [];
  const kept: string[] = [];
  const errors: DelegationError[] = [];

  for (const paragraph of paragraphs) {
    const matches: { start: number; end: number; harness: HarnessId; model: string | null; token: string }[] = [];
    MENTION_RE.lastIndex = 0;
    for (const match of paragraph.matchAll(MENTION_RE)) {
      const namespace = match[2]?.toLowerCase();
      const name = match[3]?.toLowerCase();
      if (!name) continue;
      const isBare = namespace === undefined;
      const known = harnessIdFor(name);
      if (namespace && !known) {
        errors.push({
          code: 'unknown_harness',
          message: `Unknown harness "${name}"`,
          paragraph,
        });
        continue;
      }
      if (!known) continue;
      if (isBare && agentNames.has(name)) continue;
      const tokenStart = (match.index ?? 0) + (match[1]?.length ?? 0);
      const token = match[0].slice(match[1]?.length ?? 0);
      matches.push({
        start: tokenStart,
        end: tokenStart + token.length,
        harness: known,
        model: match[4] ?? null,
        token,
      });
    }

    if (matches.length === 0) {
      if (paragraph.trim()) kept.push(paragraph.trim());
      continue;
    }
    if (matches.length > 1) {
      errors.push({
        code: 'multiple_mentions',
        message: 'One paragraph can delegate to one harness; separate workers with a blank line',
        paragraph,
      });
      continue;
    }

    const mention = matches[0];
    const task = `${paragraph.slice(0, mention.start)}${paragraph.slice(mention.end)}`
      .replace(/\s+/g, ' ')
      .replace(/^[\s,;:-]+/, '')
      .trim();
    if (!task) {
      errors.push({
        code: 'empty_task',
        message: `@${mention.token.replace(/^@/, '')} needs a task in the same paragraph`,
        paragraph,
      });
      continue;
    }
    delegations.push({
      harness: mention.harness,
      model: mention.model,
      task,
      token: mention.token,
    });
  }

  // A message that is only an unknown `@harness:` is an error, not prose.
  if (errors.length > 0) {
    return { delegations: [], orchestratorText: text.trim(), errors };
  }
  return {
    delegations,
    orchestratorText: kept.join('\n\n'),
    errors,
  };
}

/** The exact command an orchestrator runs, with the task in a heredoc. */
export function delegationCommand(delegation: HarnessDelegation, index: number): string {
  const tag = `KABMO_TASK_${index + 1}`;
  const model = delegation.model ? ` --model ${delegation.model}` : '';
  return [
    `kabmo session spawn --parent-self --harness ${delegation.harness}${model} --prompt-file - <<'${tag}'`,
    delegation.task,
    tag,
  ].join('\n');
}

/**
 * The block prepended to the orchestrator's own prompt. It names every worker,
 * gives the exact spawn command, and states the one behaviour the host cannot
 * enforce by itself: end the turn instead of polling.
 */
export function formatDelegationPrompt(plan: DelegationPlan): string {
  const lines = [
    '[kabmo orchestration contract]',
    'You are the orchestrator for this message. Start each worker below with the exact command,',
    'then end your turn. A worker sees nothing of this conversation: its TASK is the whole brief.',
    'Kabmo adds the dispatched-worker preamble and sends each worker outcome back as a new',
    'message. Do not poll, do not resend the same task, and do not delegate work that is not',
    'listed here unless the user asks.',
    '',
    'Workers:',
  ];
  plan.delegations.forEach((delegation, index) => {
    const model = delegation.model ?? 'default model';
    lines.push(
      '',
      `${index + 1}. ${HARNESS_CATALOG[delegation.harness]?.label ?? delegation.harness} · ${model}`,
      delegationCommand(delegation, index),
    );
  });
  lines.push(
    '',
    'When a worker finishes, read its output with `kabmo session output <id>` and report the',
    'result to the user. Reconcile conflicting reports; do not relay one verbatim.',
    '[/kabmo orchestration contract]',
  );
  if (plan.orchestratorText) lines.push('', plan.orchestratorText);
  return lines.join('\n');
}

/** A user-facing refusal, or null when the message can be sent. */
export function delegationErrorText(plan: DelegationPlan): string | null {
  if (plan.errors.length === 0) return null;
  return plan.errors
    .map((error) => error.message)
    .filter((message, index, all) => all.indexOf(message) === index)
    .join(' · ');
}
