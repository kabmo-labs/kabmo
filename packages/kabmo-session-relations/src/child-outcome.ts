/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "A child session settled" — raised by whatever drove the child, acted on by
 * whoever owns the parent's notifications.
 *
 * The relations package owns the parent/child shape but not the notice: deciding
 * whether a parent hears about a completion needs the parent's notification
 * preference, its archived state and the queue that carries the message. Those
 * live above this package, so the notice is registered rather than imported.
 */
import type { ChildOutcomeEntry } from '@kabmo-labs/kabmo-app-contracts/notice';

/** The notice shape the parent's banner renders, plus the session it belongs to. */
export type ChildOutcomeNotice = ChildOutcomeEntry;

type Reporter = (outcome: ChildOutcomeNotice) => void | Promise<void>;

declare global {
  // eslint-disable-next-line no-var
  var __kabmoChildOutcomeReporter: Reporter | undefined;
}

export function registerChildOutcomeReporter(reporter: Reporter | null): void {
  globalThis.__kabmoChildOutcomeReporter = reporter ?? undefined;
}

/** The reporter's promise, so the caller keeps its own failure log: a broken
 *  notice must be visible, and it must not fail the turn that produced it. */
export async function reportChildOutcome(outcome: ChildOutcomeNotice): Promise<void> {
  await globalThis.__kabmoChildOutcomeReporter?.(outcome);
}
