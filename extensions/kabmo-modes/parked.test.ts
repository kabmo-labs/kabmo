/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The parked-proposal slot: what fills it, what empties it, and the rule that
 * nothing empties it on a clock.
 *
 * The slot is module-level state (omp permits one `xd://propose` at a time per
 * session), so every test here takes it through the module's own API and leaves
 * it empty — a leaked slot would make the NEXT test's `peek` lie.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  awaitParkedProposal,
  parkProposal,
  peekParkedProposal,
  releaseForRefinement,
  releaseParkedProposal,
  takeParkedProposal,
} from './parked';

interface Resolved {
  content: Array<{ type: string; text: string }>;
  details: { planFilePath: string; title: string; planExists: boolean };
}

/** Park a proposal and hand back a recorder for how it was resolved. */
function park(title = 'migrate-importer'): { resolved: Resolved[] } {
  const resolved: Resolved[] = [];
  parkProposal({
    title,
    planFilePath: `local://${title}-plan.md`,
    planContent: '# Plan',
    resolve: (result) => resolved.push(result as Resolved),
  });
  return { resolved };
}

beforeEach(() => {
  // Drain anything a previous test left behind.
  takeParkedProposal();
});

describe('the parked proposal slot', () => {
  test('peek reports the slot without consuming it', () => {
    park('peeked');
    expect(peekParkedProposal()?.title).toBe('peeked');
    // Still there: `republish` peeks on every attach and must not steal the
    // proposal from the decision that follows.
    expect(peekParkedProposal()?.title).toBe('peeked');
    expect(takeParkedProposal()?.title).toBe('peeked');
    expect(peekParkedProposal()).toBeNull();
  });

  test('only one caller can resolve a proposal', () => {
    park();
    expect(takeParkedProposal()).not.toBeNull();
    // A second decision must be refused, not answered against a plan that was
    // already handed to the model.
    expect(takeParkedProposal()).toBeNull();
  });

  test('awaitParkedProposal resolves immediately when one is already parked', async () => {
    park();
    await awaitParkedProposal();
    expect(peekParkedProposal()?.title).toBe('migrate-importer');
  });

  test('awaitParkedProposal resolves when a proposal parks, not on its own', async () => {
    let done = false;
    const pending = awaitParkedProposal();
    void pending.then(() => { done = true; });

    // A microtask boundary: a promise that had resolved eagerly — on a timer, or
    // by pre-resolving — would report `true` here.
    await Promise.resolve();
    expect(done).toBe(false);

    park('late');
    await pending;
    expect(done).toBe(true);
    expect(peekParkedProposal()?.title).toBe('late');
  });
});

describe('releases that are not a decision', () => {
  test('a refinement release hands the model a reason and keeps the plan path', () => {
    const { resolved } = park();
    releaseForRefinement('The run was interrupted.');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.content[0]?.text).toContain('The run was interrupted.');
    // The model is told to re-propose, which is what keeps plan mode useful:
    // the path it should rewrite is carried back.
    expect(resolved[0]?.content[0]?.text).toContain('xd://propose');
    expect(resolved[0]?.details.planFilePath).toBe('local://migrate-importer-plan.md');
    expect(peekParkedProposal()).toBeNull();
  });

  test('a teardown release says it was dismissed', () => {
    const { resolved } = park();
    releaseParkedProposal();
    expect(resolved[0]?.content[0]?.text).toContain('dismissed');
  });

  test('releasing an empty slot is a no-op, not a crash', () => {
    expect(() => releaseForRefinement('nothing here')).not.toThrow();
    expect(() => releaseParkedProposal()).not.toThrow();
  });
});
