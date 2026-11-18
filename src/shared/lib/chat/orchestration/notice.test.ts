/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The injected-prompt envelope, and the outcome format both ends read.
 *
 * The reason this is a shared module and not two copies: the server WRITES the
 * text a coordinator receives and the client PARSES it back into a card. A
 * format that only one side knew would render a worker report as the
 * operator's own message, which is exactly the bug this replaced.
 */

import { describe, expect, test } from 'bun:test';
import {
  CHILD_OUTCOME,
  ORCHESTRATION_CONTRACT,
  WORKER_BRIEF,
  parseChildOutcomeNotice,
  parseOrchestrationBlock,
  renderChildOutcomeNotice,
} from '@/shared/lib/chat/orchestration/notice';

describe('parseOrchestrationBlock', () => {
  test('leaves anything a human wrote alone', () => {
    expect(parseOrchestrationBlock('fix the sidebar, please')).toBeNull();
    // A marker in the MIDDLE of prose is content, not an envelope.
    expect(parseOrchestrationBlock('see [kabmo child outcome] handling')).toBeNull();
  });

  test('splits the contract from the words the operator typed', () => {
    const text = [
      ORCHESTRATION_CONTRACT.open,
      'You are the orchestrator for this message.',
      ORCHESTRATION_CONTRACT.close,
      '',
      'koordinasikan timnya',
    ].join('\n');
    const block = parseOrchestrationBlock(text);
    expect(block?.kind).toBe('contract');
    expect(block?.body).toBe('You are the orchestrator for this message.');
    expect(block?.rest).toBe('koordinasikan timnya');
  });

  test('a worker brief is one block with no operator text', () => {
    const text = `${WORKER_BRIEF.open}\nYou are session c1.\n\nTASK\ncheck the log\n${WORKER_BRIEF.close}`;
    const block = parseOrchestrationBlock(text);
    expect(block?.kind).toBe('worker');
    expect(block?.body).toContain('check the log');
    expect(block?.rest).toBe('');
  });

  test('an unterminated marker stays prose', () => {
    // A truncated write must not swallow the rest of the message.
    const text = `${ORCHESTRATION_CONTRACT.open}\nhalf a contract`;
    expect(parseOrchestrationBlock(text)).toBeNull();
  });
});

describe('child outcome notices', () => {
  test('one worker round-trips with its reason intact', () => {
    const text = renderChildOutcomeNotice([
      {
        sessionId: 'c1',
        title: 'Agent 1',
        status: 'failed',
        failure: '400 The model agnes-2-5-flash:free is currently unavailable.',
      },
    ]);
    expect(text.startsWith(CHILD_OUTCOME.open)).toBe(true);
    const block = parseOrchestrationBlock(text);
    expect(block?.kind).toBe('outcome');
    const [entry] = parseChildOutcomeNotice(block?.body ?? '');
    expect(entry).toEqual({
      sessionId: 'c1',
      title: 'Agent 1',
      status: 'failed',
      failure: '400 The model agnes-2-5-flash:free is currently unavailable.',
    });
  });

  test('a completed worker carries its whole output, newlines included', () => {
    const output = '**Report**\n\n- did one thing\n- did another';
    const body = parseOrchestrationBlock(
      renderChildOutcomeNotice([{ sessionId: 'c1', status: 'completed', output }]),
    );
    const [entry] = parseChildOutcomeNotice(body?.body ?? '');
    expect(entry?.output).toBe(output);
    expect(entry?.failure).toBeUndefined();
  });

  test('a batch keeps every worker, in order', () => {
    const body = parseOrchestrationBlock(
      renderChildOutcomeNotice([
        { sessionId: 'c1', status: 'completed', output: 'first' },
        { sessionId: 'c2', status: 'interrupted' },
      ]),
    );
    const entries = parseChildOutcomeNotice(body?.body ?? '');
    expect(entries.map((entry) => entry.sessionId)).toEqual(['c1', 'c2']);
    expect(entries[1]?.failure).toContain('interrupted');
  });

  test('a failure states the next step so the task is not resent', () => {
    const text = renderChildOutcomeNotice([{ sessionId: 'c9', status: 'failed', failure: 'boom' }]);
    expect(text).toContain('instead of resending');
    // A failed run has no assistant answer, so `session output` would print
    // nothing — the reason above is the detail.
    expect(text).not.toContain('kabmo session output');
  });

  test('an unclassifiable status reads as failed, and a blank chunk is dropped', () => {
    const entries = parseChildOutcomeNotice('session: c1\nstatus: weird\nreason: x\n---\nno session here');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe('failed');
  });
});
