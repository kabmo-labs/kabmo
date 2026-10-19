/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The parked `xd://propose`: the slot it lives in, the plan body it carries,
 * and the ways it can be released.
 *
 * Split from `plan.ts` so the review surface owns only the DECISION (which of
 * omp's five choices, and what each one does to the session). This half knows
 * nothing about choices — it is the state a decision is made against.
 *
 * ## The parking contract
 *
 * Plan mode's approval path is a `write` to `xd://propose`, which omp dispatches
 * to whatever `setPlanProposalHandler` installed. The TUI's handler opens the
 * full-screen review overlay and resolves when the operator picks; the model's
 * tool call stays open the whole time. That is exactly what Kabmo needs —
 * the operator reviews in the web console, and the decision travels back — so
 * the handler parks the promise the same way.
 *
 * Parking is safe: measured on omp 18.4.4 with a proposal held for 45 s, the RPC
 * loop stays responsive (`get_state` answers, a second command runs) because the
 * handler blocks only the tool call, not the reader.
 *
 * ## Why it waits INDEFINITELY
 *
 * The review has no deadline, exactly like the `ask` tool: `ask.timeout`
 * defaults to 0 — "wait forever" — because a question that expires under the
 * operator is worse than one that waits. A plan review is the same kind of
 * gate, and this used to be the exception: a 30-minute timer resolved the
 * proposal as a REFINEMENT, which kept plan mode active and told the model to
 * plan again. So an operator who left a review open over lunch came back to a
 * different plan, with no notice that theirs had been discarded, while the panel
 * still showed the plan the child had already abandoned. omp itself has no such
 * timer (`peekPlanProposalHandler` is awaited with no deadline), so Kabmo
 * was inventing one.
 *
 * What keeps a parked proposal from becoming a hung run is therefore an
 * EXPLICIT exit, not a clock:
 *
 *  - the operator decides (five choices, or Dismiss, which refines);
 *  - `plan off` releases it as a refinement before tearing plan mode down, so
 *    turning the toggle off mid-review cannot strand the turn;
 *  - Stop/abort ends the turn the tool call belongs to — the same escape an
 *    unanswered `ask` has;
 *  - switching sessions or reloading does NOT touch it: the child keeps the call
 *    open and the review is re-published to whichever client attaches.
 */

import type { ExtensionCtx } from './session';

export interface ParkedProposal {
  title: string;
  planFilePath: string;
  planContent: string;
  resolve: (result: unknown) => void;
}

/** The single parked proposal for this process. omp permits one `xd://propose`
 *  at a time per session (the handler is replaced, never stacked), so a slot
 *  rather than a map is the honest shape. */
let parked: ParkedProposal | null = null;

/** Resolvers waiting for the next proposal to park. See `awaitParkedProposal`. */
let parkedWaiters: Array<() => void> = [];

/**
 * Resolve once a proposal is parked (immediately when one already is).
 *
 * A seam for the test suite, and honest about why it has to exist: parking
 * happens AFTER the plan file is read, so a caller cannot know from the return
 * of `installPlanProposal` whether the handler has reached its parked state —
 * and a test that guessed with a delay would be racing the read rather than
 * waiting for it.
 */
export function awaitParkedProposal(): Promise<void> {
  if (parked) return Promise.resolve();
  const { promise, resolve } = Promise.withResolvers<void>();
  parkedWaiters.push(resolve);
  return promise;
}

/** The parked proposal, if any. Read-only: a caller that intends to resolve it
 *  takes it through `takeParkedProposal` instead. */
export function peekParkedProposal(): ParkedProposal | null {
  return parked;
}

/** Fill the slot and wake whoever is waiting on `awaitParkedProposal`. */
export function parkProposal(proposal: ParkedProposal): void {
  parked = proposal;
  const waiters = parkedWaiters;
  parkedWaiters = [];
  for (const waiter of waiters) waiter();
}

/** Consume the slot. Exactly one caller may resolve a given proposal, which is
 *  what makes `null` here mean "somebody already answered it". */
export function takeParkedProposal(): ParkedProposal | null {
  const current = parked;
  parked = null;
  return current;
}

/**
 * omp's `local://` root resolver, loaded ON DEMAND.
 *
 * Dynamic on purpose: the module lives in the omp package, which is installed
 * in the machine's global prefix and is NOT a Kabmo dependency — a static
 * import would make this file unresolvable outside a child process (measured:
 * `bun test` on this very file failed with "Cannot find module
 * '@oh-my-pi/pi-coding-agent/internal-urls'"). Inside the child the specifier
 * resolves, and the load is cached after the first call.
 */
async function localRootResolver(): Promise<((options: unknown) => string) | null> {
  try {
    const mod: unknown = await import('@oh-my-pi/pi-coding-agent/internal-urls');
    if (mod && typeof mod === 'object' && 'resolveLocalRoot' in mod) {
      const resolver = mod.resolveLocalRoot;
      return typeof resolver === 'function' ? (resolver as (options: unknown) => string) : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Read a `local://` artifact through omp's own root mapping. */
export async function readPlanFile(ctx: ExtensionCtx, planFilePath: string): Promise<string> {
  try {
    const resolveLocalRoot = await localRootResolver();
    if (!resolveLocalRoot) return '';
    const root = resolveLocalRoot(ctx.localProtocolOptions);
    const relative = planFilePath.replace(/^local:\/+/i, '');
    const file = Bun.file(`${root}/${relative}`);
    if (!(await file.exists())) return '';
    return await file.text();
  } catch {
    // A plan that cannot be read is reported as an empty body; the approval
    // itself still works, because omp re-reads the file its own way.
    return '';
  }
}

/** Resolve a parked proposal with a refinement request, which keeps plan mode
 *  active and hands the model a reason instead of a decision. */
export function releaseForRefinement(reason: string): void {
  const current = takeParkedProposal();
  if (!current) return;
  current.resolve({
    content: [{ type: 'text', text: `${reason} Update the plan file, then write its title to xd://propose again.` }],
    details: { planFilePath: current.planFilePath, title: current.title, planExists: true },
  });
}

/** Release the parked proposal because plan mode is being torn down. */
export function releaseParkedProposal(): void {
  releaseForRefinement('Plan review was dismissed.');
}
