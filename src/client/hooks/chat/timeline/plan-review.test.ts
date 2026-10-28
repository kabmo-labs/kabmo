/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The plan-review proposal parser.
 *
 * The proposal travels as a JSON payload on a notice marker, so the reader has
 * to be strict about what it accepts: a half-parsed proposal would render a
 * review panel over a plan the agent is parked on, and the operator could not
 * tell that from a plan that really is empty.
 */

import { describe, expect, test } from 'bun:test';
import { proposalFromMarkerPayload } from '@/client/hooks/chat/timeline/plan-review';

describe('proposalFromMarkerPayload', () => {
  test('reads a well-formed proposal', () => {
    const proposal = proposalFromMarkerPayload({
      title: 'migrate-importer',
      planFilePath: 'local://migrate-importer-plan.md',
      planContent: '# Plan\n\nDo the thing.',
    });
    expect(proposal).toEqual({
      title: 'migrate-importer',
      planFilePath: 'local://migrate-importer-plan.md',
      planContent: '# Plan\n\nDo the thing.',
    });
  });

  test('rejects a proposal with no title or no path', () => {
    // The panel needs both: a title to name the review, and a path to hand back
    // on approval.
    expect(proposalFromMarkerPayload({ planFilePath: 'local://x-plan.md' })).toBeNull();
    expect(proposalFromMarkerPayload({ title: 'x' })).toBeNull();
    expect(proposalFromMarkerPayload({})).toBeNull();
    expect(proposalFromMarkerPayload({ title: 1, planFilePath: 'local://x-plan.md' })).toBeNull();
  });

  test('a missing body becomes empty rather than rejecting the proposal', () => {
    // A plan the child could not read still has to be reviewable: the approval
    // is what unblocks the agent, and the body is context.
    const proposal = proposalFromMarkerPayload({ title: 'x', planFilePath: 'local://x-plan.md' });
    expect(proposal?.planContent).toBe('');
  });
});
