/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The plan-review decision, end to end inside the extension.
 *
 * Every exit path must report itself. The panel closes on the child's
 * `CHAMBER_PLAN_DECISION` marker and NOT on the HTTP request returning — it
 * stays up while the decision is in flight, deliberately, so a decision that
 * silently failed cannot leave the operator looking at a plan nobody is waiting
 * on.
 *
 * That contract was broken for `Refine plan`: the branch resolved the parked
 * promise (so the agent started planning again) but returned without a marker,
 * and the panel sat on screen over a live agent. It was found in the browser,
 * not by a unit test — hence this file.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { awaitParkedProposal, decidePlan, installPlanProposal } from './plan';
import {
  CHAMBER_PLAN_DECISION_MARKER,
  CHAMBER_PLAN_PROPOSAL_MARKER,
  CHAMBER_PLAN_STATE_MARKER,
} from './protocol';
import type { ExtensionCtx, ModeApi, ModeSession } from './session';

/** The handler the extension installs, exposed so a test can drive it. */
interface HandlerHost {
  handler?: (title: string) => Promise<unknown>;
}

interface Harness {
  api: ModeApi;
  session: ModeSession;
  ctx: ExtensionCtx;
  notices: string[];
  appended: Array<{ customType: string; data: unknown }>;
  sent: Array<{ customType: string; content: string }>;
  /** Delays any timer the extension armed would have fired at. */
  timerArms: number[];
  planEnabled: () => boolean;
  /** The promise omp awaits as the `write xd://propose` tool result. Set by
   *  `propose`, and the thing every choice must settle. */
  toolCall: Promise<unknown> | null;
}

function harness(): Harness {
  const notices: string[] = [];
  const appended: Harness['appended'] = [];
  const sent: Harness['sent'] = [];
  let planState: { enabled: boolean; planFilePath: string } | undefined = {
    enabled: true,
    planFilePath: 'local://PLAN.md',
  };

  const host: HandlerHost = {};
  const session: ModeSession = {
    getPlanModeState: () => planState,
    setPlanModeState: (state) => {
      planState = state;
    },
    setPlanProposalHandler: (handler) => {
      host.handler = handler ?? undefined;
    },
    preparePlanForReview: async (title: string) => ({
      details: { planFilePath: `local://${title}-plan.md`, title, planExists: true },
    }),
    setPlanReferencePath: () => {},
    sessionManager: { appendModeChange: () => 'id', getSessionId: () => 's1' },
  };

  const api: ModeApi = {
    appendEntry: (customType, data) => appended.push({ customType, data }),
    sendMessage: (message) => sent.push({ customType: message.customType, content: message.content }),
  };

  // The review must arm NO timer: omp's own handler is awaited with no
  // deadline, and `ask.timeout` defaults to 0 for the same reason. Spying on
  // the ctx hooks is what makes a re-added deadline a test failure rather than
  // a silent behaviour change — the shape is widened locally so the spy does
  // not put the hooks back on the production interface.
  const timerArms: number[] = [];
  const timerHost = {
    setTimeout: (_callback: (...args: unknown[]) => void, ms?: number) => {
      timerArms.push(ms ?? 0);
      return 1;
    },
    clearTimer: () => {},
  };
  const ctx: ExtensionCtx = {
    cwd: '/tmp/plan-review-test',
    ui: { notify: (message) => notices.push(message) },
    ...timerHost,
  };

  // Expose the installed handler through the session object the harness owns, so
  // the test never re-derives it from a cast at the call site.
  (session as unknown as HandlerHost).handler = undefined;
  const exposed: Harness & HandlerHost = {
    api,
    session,
    ctx,
    notices,
    appended,
    sent,
    timerArms,
    planEnabled: () => planState?.enabled === true,
    toolCall: null,
  };
  Object.defineProperty(exposed, 'handler', {
    get: () => host.handler,
  });
  return exposed;
}

/** Install the handler and park a proposal through it.
 *
 *  Awaits the parked state rather than a duration: the handler reads the plan
 *  file first, so the return of `installPlanProposal` says nothing about when
 *  the slot is filled. The handler's promise is kept on the harness because it
 *  IS the model's open tool call — the thing every choice has to settle. */
async function propose(h: Harness): Promise<void> {
  installPlanProposal(h.session, h.ctx);
  const handler = (h as Harness & HandlerHost).handler;
  if (!handler) throw new Error('proposal handler was not installed');
  h.toolCall = handler('migrate-importer');
  await awaitParkedProposal();
}

/**
 * The parked proposal is module-level state (omp permits one `xd://propose` at
 * a time per session), so a test that proposes and does not decide would leave
 * its proposal parked for the next one. Cleared through the extension's own
 * public teardown — the same call `plan off` makes.
 */
beforeEach(() => {
  const h = harness();
  installPlanProposal(h.session, h.ctx, { clear: true });
});

function markers(h: Harness): string[] {
  return h.notices.filter((n) => n.startsWith('CHAMBER_'));
}

function decisionOf(h: Harness): Record<string, unknown> | undefined {
  const marker = markers(h).find((m) => m.startsWith(CHAMBER_PLAN_DECISION_MARKER));
  if (!marker) return undefined;
  const parsed: unknown = JSON.parse(marker.slice(CHAMBER_PLAN_DECISION_MARKER.length));
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
}

/** The `details` bag of a settled `xd://propose` result, narrowed rather than
 *  asserted: the promise's value is `unknown`, so the read is checked. */
function planDetailsOf(result: unknown): { planFilePath?: string; title?: string } | undefined {
  if (!result || typeof result !== 'object' || !('details' in result)) return undefined;
  const { details } = result;
  if (!details || typeof details !== 'object') return undefined;
  const planFilePath = 'planFilePath' in details && typeof details.planFilePath === 'string' ? details.planFilePath : undefined;
  const title = 'title' in details && typeof details.title === 'string' ? details.title : undefined;
  return { planFilePath, title };
}

describe('decidePlan', () => {
  test('a proposal is announced to the console', async () => {
    const h = harness();
    await propose(h);
    const proposal = markers(h).find((m) => m.startsWith(CHAMBER_PLAN_PROPOSAL_MARKER));
    expect(proposal).toBeDefined();
    const payload = JSON.parse((proposal as string).slice(CHAMBER_PLAN_PROPOSAL_MARKER.length)) as { title?: string };
    expect(payload.title).toBe('migrate-importer');
  });

  test('Refine reports the decision and keeps plan mode on', async () => {
    const h = harness();
    await propose(h);
    expect(await decidePlan(h.api, h.session, h.ctx, 'Refine plan', 'shorter')).toBe(true);
    // The marker is what closes the panel; without it the review surface stayed
    // up over an agent that was already planning again.
    expect(decisionOf(h)?.choice).toBe('Refine plan');
    // Refine keeps plan mode ON: the model is expected to revise and re-propose.
    expect(h.planEnabled()).toBe(true);
  });

  test('each approve variant reports the decision and leaves plan mode', async () => {
    for (const choice of [
      'Approve and execute',
      'Approve and compact context',
      'Approve and keep context',
    ]) {
      const h = harness();
      await propose(h);
      expect(await decidePlan(h.api, h.session, h.ctx, choice, '')).toBe(true);
      expect(decisionOf(h)?.choice).toBe(choice);
      expect(h.planEnabled()).toBe(false);
      // The execution turn rides a hidden message, so the transcript carries the
      // plan without a visible "Plan approved." bubble.
      expect(h.sent).toHaveLength(1);
      expect(h.sent[0]?.content).toContain('Plan approved');
    }
  });

  /**
   * The invariant the approve branches were missing.
   *
   * The parked promise IS the model's open `write xd://propose` tool call —
   * omp awaits the handler's return value as that call's result. A choice that
   * returns without resolving leaves the call open, so the planning turn never
   * ends: the child streams forever, `agent_end` never arrives, and the next
   * prompt is refused. Measured on omp 18.11.2 through the real RPC path before
   * this was fixed: `Approve and keep context` left the session
   * `isStreaming: true` indefinitely (transcript stopped at the tool call, a
   * follow-up prompt refused), while `Approve and execute` and
   * `Approve and compact context` only MASKED it — their `newSession` /
   * `compact` reset the agent's streaming state, so the run looked finished
   * with the promise still pending.
   *
   * The race is what makes an unsettled promise observable: `toolCall` resolves
   * before this runs when the choice settled it, so its reaction is queued
   * first and wins against an already-resolved sentinel — and the sentinel wins
   * when it never settles.
   */
  test('every choice SETTLES the parked tool call', async () => {
    const NOT_SETTLED = Symbol('not-settled');
    for (const [choice, feedback] of [
      ['Approve and execute', ''],
      ['Approve and compact context', ''],
      ['Approve and keep context', ''],
      ['Refine plan', 'shorter'],
      ['Save and quit', ''],
    ] as const) {
      const h = harness();
      await propose(h);
      const toolCall = h.toolCall;
      if (!toolCall) throw new Error('propose did not expose the tool call');
      expect(await decidePlan(h.api, h.session, h.ctx, choice, feedback)).toBe(true);
      const result: unknown = await Promise.race([toolCall, Promise.resolve(NOT_SETTLED)]);
      expect(result).not.toBe(NOT_SETTLED);
      // The result is the tool output the model reads, so it must name the plan
      // the way omp's own `preparePlanForReview` does.
      const details = planDetailsOf(result);
      expect(details?.title).toBe('migrate-importer');
      expect(details?.planFilePath).toContain('migrate-importer');
    }
  });

  test('leaving plan mode is both PERSISTED and broadcast', async () => {
    const h = harness();
    await propose(h);
    await decidePlan(h.api, h.session, h.ctx, 'Approve and keep context', '');
    // The entry is what a reload reads back, and the marker is what moves the
    // composer's toggle right now. Writing only the entry left the Plan button
    // showing as pressed over a session that was already executing — found in
    // the browser, which is why both halves are asserted here.
    const planEntries = h.appended.filter((e) => e.customType === 'chamber-plan-state');
    expect(planEntries.at(-1)?.data).toEqual({ enabled: false });
    const planState = markers(h).filter((m) => m.startsWith(CHAMBER_PLAN_STATE_MARKER));
    const last = JSON.parse((planState.at(-1) as string).slice(CHAMBER_PLAN_STATE_MARKER.length)) as { enabled?: boolean };
    expect(last.enabled).toBe(false);
  });

  test('a decision with nothing parked is refused, not silently dropped', async () => {
    const h = harness();
    expect(await decidePlan(h.api, h.session, h.ctx, 'Approve and keep context', '')).toBe(false);
  });

  test('the review waits with NO deadline, like the ask tool', async () => {
    const h = harness();
    await propose(h);
    // A parked review must not expire under the operator. The 30-minute timer
    // this used to arm resolved the proposal as a REFINEMENT, so a review left
    // open came back as a different plan with the panel still showing the
    // abandoned one. `ask.timeout` defaults to 0 — "wait forever" — and this is
    // the same kind of gate, so nothing may be armed at all.
    expect(h.timerArms).toEqual([]);

    // And the proposal really is still pending: a decision is what resolves it.
    expect(await decidePlan(h.api, h.session, h.ctx, 'Approve and keep context', '')).toBe(true);
    expect(decisionOf(h)?.choice).toBe('Approve and keep context');
  });
});
