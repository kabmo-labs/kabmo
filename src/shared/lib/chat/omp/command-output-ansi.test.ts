/**
 * @license
 * SPDX-License-Identifier: MIT
 *
 * Builtin-command output must be stripped of ANSI on BOTH paths that can render
 * it: the live `command_output` frame and the custom entry a reload replays.
 * The two are separate code paths, and a fix applied to only one makes a
 * command's output change appearance when the page is refreshed — measured on
 * `/context`, whose progress bars carry 48 escape bytes that the notice card
 * drew literally as `38;2;107;114;128m████…`.
 */

import { describe, expect, test } from 'bun:test';

import { foldAgentEvent, type OmpAgentFoldDeps } from '@/shared/lib/chat/omp/agent-events';
import { noticeFromCustomMessage } from '@/shared/lib/omp/session/messages-map';

/** The real shape omp emits for `/context`: SGR runs around half-block bars. */
const CONTEXT_OUTPUT = 'Context window: 1000000 tokens (1% used)\n'
  + '  System prompt    [\u001b[38;2;107;114;128m░░░░░░\u001b[39m\u001b[1m\u001b[38;2;0;180;255m░░░░\u001b[22m\u001b[39m] 0%  2541 tokens';

function foldDeps(): { deps: OmpAgentFoldDeps; outputs: string[] } {
  const outputs: string[] = [];
  const noop = () => {};
  const ref = <T,>(value: T) => ({ current: value });
  const deps = {
    setState: noop,
    sessionId: 'test-session',
    callbacksRef: {
      current: {
        onCommandOutput: (text: string) => outputs.push(text),
      },
    },
    toolResultsRef: ref(new Map()),
    lastToolMessageRef: ref(null),
    activityRef: ref(''),
    providerRetryVerbRef: ref(null),
    currentThinkingLevelRef: ref(undefined),
    fileMutatingCallsRef: ref(new Set()),
  } as unknown as OmpAgentFoldDeps;
  return { deps, outputs };
}

describe('command_output ANSI stripping (live path)', () => {
  test('strips escapes before the notice row sees them', () => {
    const { deps, outputs } = foldDeps();
    foldAgentEvent({ type: 'command_output', text: CONTEXT_OUTPUT }, deps);

    expect(outputs).toHaveLength(1);
    expect(outputs[0]).not.toContain('\u001b');
    // The content itself survives — only the escapes go.
    expect(outputs[0]).toContain('Context window: 1000000 tokens');
    expect(outputs[0]).toContain('░░░░░░');
  });

  test('keeps the empty-frame guard', () => {
    const { deps, outputs } = foldDeps();
    foldAgentEvent({ type: 'command_output', text: '  \u001b[39m ' }, deps);
    expect(outputs).toEqual([]);
  });
});

describe('noticeFromCustomMessage ANSI stripping (reload path)', () => {
  test('strips escapes from a replayed custom entry', () => {
    const notice = noticeFromCustomMessage({
      type: 'custom_message',
      customType: 'command_output',
      content: CONTEXT_OUTPUT,
    });

    expect(notice).not.toBeNull();
    expect(notice?.notice).not.toContain('\u001b');
    expect(notice?.notice).toContain('Context window: 1000000 tokens');
  });

  test('still unwraps a system-notice envelope', () => {
    const notice = noticeFromCustomMessage({
      type: 'custom_message',
      customType: 'notice',
      content: '<system-notice>\u001b[32mAll good\u001b[39m</system-notice>',
    });
    expect(notice?.notice).toBe('All good');
  });
});
