/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Live SSE adapter (`mapper.ts`) plus the two helpers it shares with the JSONL
 * reload path: `timestamps.ts` and `turn-error.ts`.
 *
 * The live path decides what the user sees *while* a turn streams, and it
 * diverges from the reload path in ways that must stay pinned: tool calls start
 * `running`, thinking is `isGenerating`, and custom/developer/system frames
 * become notice rows instead of assistant prose. The error/timestamp helpers
 * are pinned here because a wrong answer makes an aborted turn vanish live
 * (the empty-content guard) or renders a turn with the wrong clock.
 */

import { describe, expect, test } from 'bun:test';

import { extractTextFromContent, toChatMessage, toolResultText } from '@/shared/lib/omp/session/mapper';
import { toEpochMs } from '@/shared/lib/omp/session/timestamps';
import { deriveTurnError, turnStoppedAbnormally } from '@/shared/lib/omp/session/turn-error';

const CLOCK_RE = /^\d{1,2}:\d{2} (AM|PM)$/;

describe('toChatMessage — custom frames', () => {
  test('turns a custom frame into a notice row and keeps its customType as the source', () => {
    const msg = toChatMessage({
      role: 'custom',
      id: 'n1',
      customType: 'ultrathink-notice',
      content: '<system-notice>thinking budget raised</system-notice>',
    });
    expect(msg).toEqual({
      id: 'n1',
      role: 'ai',
      content: '',
      notice: 'thinking budget raised',
      noticeSource: 'ultrathink-notice',
    });
  });

  test('drops session_exit frames — runtime plumbing, never user-visible', () => {
    expect(toChatMessage({ role: 'custom', customType: 'session_exit', content: 'bye' })).toBeNull();
  });

  test('joins text blocks and ignores non-text blocks', () => {
    const msg = toChatMessage({
      role: 'custom',
      id: 'n2',
      customType: 'xdev-mount-notice',
      content: [{ type: 'text', text: 'a' }, { type: 'image', data: 'A' }, { type: 'text', text: 'b' }],
    });
    expect(msg?.notice).toBe('ab');
  });

  test('keeps a runtime-notice wrapper (it identifies the card variant)', () => {
    const msg = toChatMessage({ role: 'custom', id: 'n3', customType: 'x', content: '<system-reminder>keep</system-reminder>' });
    expect(msg?.notice).toBe('<system-reminder>keep</system-reminder>');
  });

  test('drops a custom frame with no text', () => {
    expect(toChatMessage({ role: 'custom', customType: 'x', content: [] })).toBeNull();
    expect(toChatMessage({ role: 'custom', customType: 'x', content: '   ' })).toBeNull();
  });
});

describe('toChatMessage — notice roles and reminder envelopes', () => {
  test('renders a developer turn as a notice with the clock stamp', () => {
    const msg = toChatMessage({ role: 'developer', id: 'd1', content: 'do not guess', timestamp: 1737000000000 });
    expect(msg?.role).toBe('ai');
    expect(msg?.content).toBe('');
    expect(msg?.notice).toBe('do not guess');
    expect(msg?.timestamp).toMatch(CLOCK_RE);
    expect(msg?.date).toBe(`Today, ${msg?.timestamp}`);
  });

  test('renders a system turn as a notice too', () => {
    expect(toChatMessage({ role: 'system', id: 's1', content: 'sys rule' })?.notice).toBe('sys rule');
  });

  test('a reminder envelope text part becomes the notice', () => {
    const msg = toChatMessage({
      role: 'assistant',
      id: 'a1',
      content: [{ type: 'text', text: '<system-reminder reason="rule">stop</system-reminder>' }],
    });
    expect(msg?.notice).toBe('<system-reminder reason="rule">stop</system-reminder>');
    expect(msg?.content).toBe('');
  });

  test('prose that merely quotes the tag stays content', () => {
    const msg = toChatMessage({
      role: 'assistant',
      id: 'a2',
      content: [{ type: 'text', text: 'see <system-reminder> handling for details' }],
    });
    expect(msg?.notice).toBeUndefined();
    expect(msg?.content).toBe('see <system-reminder> handling for details');
  });

  test('a developer turn with no text yields nothing', () => {
    expect(toChatMessage({ role: 'developer', id: 'd2', content: [] })).toBeNull();
  });
});

describe('toChatMessage — user turns', () => {
  test('keeps the prompt text and reports an empty attachment list', () => {
    const msg = toChatMessage({ role: 'user', id: 'u1', content: 'hello', timestamp: 1737000000000 });
    expect(msg?.role).toBe('user');
    expect(msg?.content).toBe('hello');
    expect(msg?.attachments as unknown).toEqual([]);
    expect(msg?.startedAt).toBe(1737000000000);
  });

  test('recovers an inlined text file as an attachment chip and strips it from the text', () => {
    const msg = toChatMessage({ role: 'user', id: 'u2', content: 'q\n\nAttached file: a.md\n```markdown\nA\n```' });
    if (!msg?.attachments) throw new Error('expected the inlined file to become an attachment');
    expect(msg?.content).toBe('q');
    expect(msg?.attachments as unknown).toEqual([{ id: 'text-1', name: 'a.md', preview: '', type: 'text/plain', content: 'A' }]);
  });

  test('turns an image content block into a data-URL attachment', () => {
    const msg = toChatMessage({
      role: 'user',
      id: 'u3',
      content: [{ type: 'text', text: 'look' }, { type: 'image', data: 'AAA', mimeType: 'image/jpeg' }],
    });
    expect(msg?.attachments as unknown).toEqual([
      { id: 'att-1', name: 'attachment-1.jpeg', preview: 'data:image/jpeg;base64,AAA', type: 'image/jpeg' },
    ]);
  });

  test('takes startedAt from an ISO timestamp or a separate startedAt field', () => {
    expect(toChatMessage({ role: 'user', id: 'u4', content: 'x', timestamp: '2026-01-02T03:04:05.000Z' })?.startedAt).toBe(1767323045000);
    expect(toChatMessage({ role: 'user', id: 'u5', content: 'x', startedAt: '2026-01-02T03:04:05.000Z' })?.startedAt).toBe(1767323045000);
  });

  test('carries the attribution when omp recorded one', () => {
    expect(toChatMessage({ role: 'user', id: 'u6', content: 'x', attribution: 'agent' })?.attribution).toBe('agent');
  });
});

describe('toChatMessage — assistant turns', () => {
  test('starts a streamed tool call as running and an already-finished one as success', () => {
    const content = [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } }];
    expect(toChatMessage({ role: 'assistant', id: 'a1', content })?.toolCalls?.[0]?.status).toBe('running');
    expect(toChatMessage({ role: 'assistant', id: 'a2', content }, false)?.toolCalls?.[0]?.status).toBe('success');
  });

  test('marks thinking as still generating while streaming', () => {
    const msg = toChatMessage({ role: 'assistant', id: 'a3', content: [{ type: 'thinking', thinking: 'hmm' }] });
    expect(msg?.thinking).toEqual({ thought: 'hmm', isGenerating: true });
  });

  test('derives completedAt from timestamp + duration when omp omitted it', () => {
    const msg = toChatMessage({ role: 'assistant', id: 'a4', content: 'x', timestamp: 1000, duration: 500 });
    expect(msg?.startedAt).toBe(1000);
    expect(msg?.completedAt).toBe(1500);
    expect(msg?.durationMs).toBe(500);
  });

  test('prefers an explicit completedAt over the derived one', () => {
    const msg = toChatMessage({ role: 'assistant', id: 'a5', content: 'x', timestamp: 1000, duration: 500, completedAt: 9999 });
    expect(msg?.completedAt).toBe(9999);
  });

  test('reads durationMs as the fallback duration field', () => {
    expect(toChatMessage({ role: 'assistant', id: 'a6', content: 'x', timestamp: 1000, durationMs: 250 })?.durationMs).toBe(250);
  });

  test('carries model, provider and usage through', () => {
    const msg = toChatMessage({ role: 'assistant', id: 'a7', content: 'x', model: 'm', provider: 'p', usage: { input: 3 } });
    expect(msg?.model).toBe('m');
    expect(msg?.provider).toBe('p');
    expect(msg?.usage).toEqual({ input: 3 });
  });

  test('an aborted turn survives the empty-content guard with its error', () => {
    // Without this the failure row would only appear after a JSONL reload.
    const msg = toChatMessage({ role: 'assistant', id: 'a8', content: [], stopReason: 'aborted', errorStatus: 500, errorMessage: 'boom' });
    expect(msg?.error).toEqual({ status: 500, id: undefined, message: 'boom', stopReason: 'aborted' });
  });

  test('an explicit nested error object wins over the flat fields', () => {
    const msg = toChatMessage({ role: 'assistant', id: 'a9', content: 'x', error: { status: 1 } });
    expect(msg?.error).toEqual({ status: 1 });
  });

  test('a turn with nothing at all yields null', () => {
    expect(toChatMessage({ role: 'assistant', id: 'a10', content: [] })).toBeNull();
  });

  test('a summary-only turn is kept', () => {
    expect(toChatMessage({ role: 'assistant', id: 'a11', content: [], summary: 'sum' })?.summary).toBe('sum');
  });

  test('an unknown role is treated as assistant', () => {
    expect(toChatMessage({ role: 'weird', id: 'a12', content: 'text' })?.role).toBe('ai');
  });
});

describe('toolResultText and extractTextFromContent', () => {
  test('passes a string result through', () => {
    expect(toolResultText('out')).toBe('out');
  });

  test('unwraps the content-block shape a tool event carries', () => {
    expect(toolResultText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('a\nb');
  });

  test('is empty for a non-string, non-object value', () => {
    expect(toolResultText(5)).toBe('');
    expect(toolResultText(null)).toBe('');
  });

  test('extractTextFromContent joins block text with a newline, not a space', () => {
    // Deliberately differs from jsonl.ts's same-named helper, which joins with
    // a space: the live path must keep the model's own line structure.
    expect(extractTextFromContent([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb');
    expect(extractTextFromContent('plain')).toBe('plain');
    expect(extractTextFromContent(7)).toBe('');
  });
});

describe('toEpochMs', () => {
  test('passes a finite epoch-millis number through', () => {
    expect(toEpochMs(1737000000000)).toBe(1737000000000);
  });

  test('parses an ISO string', () => {
    expect(toEpochMs('2026-01-02T03:04:05.000Z')).toBe(1767323045000);
  });

  test('is undefined for an unparseable string', () => {
    expect(toEpochMs('not a date')).toBeUndefined();
    expect(toEpochMs('')).toBeUndefined();
  });

  test('is undefined for non-finite numbers', () => {
    expect(toEpochMs(Number.NaN)).toBeUndefined();
    expect(toEpochMs(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  test('is undefined for a numeric string — only real numbers are epochs', () => {
    expect(toEpochMs('1737000000000')).toBeUndefined();
  });

  test('is undefined for null, objects and booleans', () => {
    expect(toEpochMs(null)).toBeUndefined();
    expect(toEpochMs({})).toBeUndefined();
    expect(toEpochMs(true)).toBeUndefined();
  });
});

describe('turnStoppedAbnormally', () => {
  test('is true for the aborted and error stop reasons', () => {
    expect(turnStoppedAbnormally({ stopReason: 'aborted' })).toBe(true);
    expect(turnStoppedAbnormally({ stopReason: 'error' })).toBe(true);
  });

  test('is false for a normal stop reason', () => {
    expect(turnStoppedAbnormally({ stopReason: 'endTurn' })).toBe(false);
    expect(turnStoppedAbnormally({})).toBe(false);
  });

  test('is true for a flat errorStatus — including status 0', () => {
    expect(turnStoppedAbnormally({ errorStatus: 0 })).toBe(true);
    expect(turnStoppedAbnormally({ errorStatus: 401 })).toBe(true);
  });

  test('is true for a flat errorMessage, even an empty one', () => {
    expect(turnStoppedAbnormally({ errorMessage: '' })).toBe(true);
  });

  test('ignores a non-string errorMessage', () => {
    expect(turnStoppedAbnormally({ errorMessage: null })).toBe(false);
  });
});

describe('deriveTurnError', () => {
  test('is undefined for a normally finished turn, keeping the caller empty-content guard intact', () => {
    expect(deriveTurnError({ stopReason: 'endTurn' })).toBeUndefined();
    expect(deriveTurnError({})).toBeUndefined();
  });

  test('collects every flat error field omp wrote', () => {
    expect(deriveTurnError({ stopReason: 'aborted', errorStatus: 401, errorId: 7, errorMessage: 'x' })).toEqual({
      status: 401,
      id: 7,
      message: 'x',
      stopReason: 'aborted',
    });
  });

  test('keeps only the fields that are actually present', () => {
    expect(deriveTurnError({ errorStatus: 500 })).toEqual({ status: 500, id: undefined, message: undefined, stopReason: undefined });
  });
});
