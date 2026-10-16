/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The goal progress check: an INDEPENDENT auditor, asked after every turn.
 *
 * Why a separate call and not the working agent's own word: an agent that
 * judges its own completion can settle a goal it has not finished, and the
 * guard chain the loop used before could only see ceilings and budgets — never
 * whether the objective had actually been met. The audit is the termination
 * authority; the loop merely obeys it.
 *
 * The check is three yes/no questions about the agent's OWN REPORT (the last
 * assistant message), answered from the objective alone — no conversation
 * history, which is why an objective has to be self-contained. The questions
 * mirror OpenChamber's `packages/web/server/lib/session-goal/audit.js`: their
 * wording is measured against a labelled set of goal turns, so it is worth
 * keeping the shape of the three (`all_done`, `remaining`, `needs_user`) and
 * the decision table that reads them.
 *
 * Transport: a one-shot `omp -p --no-session --no-tools` with the prompt on
 * stdin — the same print mode this repo's own bot scripts use. A process per
 * audit costs a spawn, and that is the point: the audit is a model call, so the
 * window it occupies is real time the UI can honestly report as "evaluating".
 */

import { stripChamberHostEnv } from '@ompchamber/plugin-sdk';
import { resolveOmpBin } from '@/server/lib/omp/core/cli';

export interface GoalAuditAnswers {
  allDone: boolean;
  remaining: boolean;
  needsUser: boolean;
}

export type GoalVerdict = 'continue' | 'complete' | 'blocked';

export interface GoalAuditRequest {
  objective: string;
  /** The agent's latest message — its own report of what is done. */
  answer: string;
  /** Working directory of the session being audited. */
  cwd: string;
  /** Model override (`provider/modelId`); omp's own default otherwise. */
  model?: string;
  timeoutMs?: number;
}

/**
 * Generous on purpose: the audit is a real model call, and measured latency for
 * the same trivial prompt on this machine ranged from 4.5 s to over 30 s.
 * Expiring early would turn a slow provider into "the check could not run",
 * which the driver treats as a reason to stand the loop down — the honest
 * failure is a longer "evaluating" window, not a stopped goal.
 */
export const GOAL_AUDIT_TIMEOUT_MS = 60_000;

/** The report sits at the END of a long turn, so the tail matters most — and
 *  the head is kept for the case where the model front-loads its summary.
 *  Same split OpenChamber uses (2k head / 8k tail). */
const ANSWER_HEAD = 2_000;
const ANSWER_TAIL = 8_000;

function excerpt(answer: string): string {
  const text = answer.trim();
  if (text.length <= ANSWER_HEAD + ANSWER_TAIL) return text;
  return `${text.slice(0, ANSWER_HEAD).trimEnd()}\n[…]\n${text.slice(-ANSWER_TAIL).trimStart()}`;
}

export function buildGoalAuditPrompt(objective: string, answer: string): string {
  return [
    'You check the progress of an AI coding agent. Answer three yes/no questions and return exactly one JSON object and nothing else — no prose, no markdown, no code fences: {"all_done": boolean, "remaining": boolean, "needs_user": boolean}.',
    'A user gave the agent the goal in `objective`. `answer` is the agent\'s latest message, which ends with a report of what is done and what remains.',
    [
      'all_done: Does `answer` report that all the work requested in `objective` is done?',
      '  true: every part the objective asks for is reported done. Steps left only for the user — testing in the app, reviewing, committing — and optional ideas the objective never asked for do not count against it.',
      '  false: some requested part is reported unfinished, skipped, postponed, not started or only partly done, or the agent narrowed the goal to a subset, even if the message says "done".',
    ].join('\n'),
    [
      'remaining: Does `answer` name requested work that the agent itself still has to do?',
      '  true: the message lists or mentions remaining steps of the objective the agent can still carry out, or says it will continue, fix, retry or finish something.',
      '  false: nothing of the objective is left for the agent — either everything is done, or what is left needs the user, or it is only user-side checking or an optional unrequested idea.',
    ].join('\n'),
    [
      'needs_user: Does `answer` say the agent cannot go on with the objective without something only the user can provide?',
      '  true: the agent is stopped by missing credentials, login, keys or access; a decision only the user can make; a device or machine it cannot reach; or an external failure it cannot work around.',
      '  false: the agent can keep going on its own — it picked a sensible default, the problem is one it can fix or retry, it only asks an optional question, or all that is left for the user is testing or review of finished work.',
    ].join('\n'),
    `<objective>\n${objective}\n</objective>`,
    `<answer>\n${excerpt(answer)}\n</answer>`,
    'Return the JSON.',
  ].join('\n\n');
}

/** Read the three answers out of the model's reply, or null when it did not
 *  answer the asked-for JSON (a prose answer, a refusal, a timeout). */
export function readGoalAuditAnswers(text: string): GoalAuditAnswers | null {
  const match = /\{[\s\S]*\}/.exec(text ?? '');
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const allDone = record.all_done;
  const remaining = record.remaining;
  const needsUser = record.needs_user;
  if (typeof allDone !== 'boolean' || typeof remaining !== 'boolean' || typeof needsUser !== 'boolean') return null;
  return { allDone, remaining, needsUser };
}

/**
 * The decision, in code — never asked of the model.
 *
 * `blocked` first: a turn waiting on the user is not finished even when
 * everything else is done. `complete` needs the report to say all is done AND
 * to name nothing left for the agent; anything else keeps the goal going.
 */
export function decideGoalProgress(answers: GoalAuditAnswers): GoalVerdict {
  if (answers.needsUser) return 'blocked';
  if (answers.allDone && !answers.remaining) return 'complete';
  return 'continue';
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text();
}

export interface GoalAuditDeps {
  resolveBin?: () => string | null;
}

/** Run one audit. Null means the check could not be taken (no binary, timeout,
 *  a non-zero exit, an unusable reply) — the driver decides what that means. */
export async function runGoalAudit(
  request: GoalAuditRequest,
  deps: GoalAuditDeps = {},
): Promise<GoalAuditAnswers | null> {
  const bin = (deps.resolveBin ?? resolveOmpBin)();
  if (!bin) return null;

  // `--thinking off` is not a shortcut, it is the audit's whole cost profile:
  // measured on this machine, a one-line reply took 26.7 s with reasoning on
  // and 4.5 s with it off — and the auditor is a classification, not a task.
  const args = ['-p', '--no-session', '--no-tools', '--no-lsp', '--thinking', 'off', '--cwd', request.cwd];
  if (request.model) args.push('--model', request.model);

  try {
    const proc = Bun.spawn({
      cmd: [bin, ...args],
      cwd: request.cwd,
      // The auditor is a reader: no session, no tools, no title, and the
      // chamber's own port/password must not leak into it.
      env: stripChamberHostEnv({ ...Bun.env, PI_NO_TITLE: '1' }, process.platform),
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      windowsHide: true,
    });

    const killer = setTimeout(() => {
      void proc.kill();
    }, request.timeoutMs ?? GOAL_AUDIT_TIMEOUT_MS);

    try {
      // The prompt goes on stdin, not on the command line: an excerpt can be
      // 10 KB, and `omp -p` reads stdin when no message argument is given.
      proc.stdin.write(buildGoalAuditPrompt(request.objective, request.answer));
      await proc.stdin.end();
      const [stdout, exitCode] = await Promise.all([readStream(proc.stdout), proc.exited]);
      if (exitCode !== 0) return null;
      return readGoalAuditAnswers(stdout);
    } finally {
      clearTimeout(killer);
      void readStream(proc.stderr).catch(() => '');
    }
  } catch {
    // A spawn failure (out of descriptors) is an audit that could not be
    // taken, not a verdict.
    return null;
  }
}
