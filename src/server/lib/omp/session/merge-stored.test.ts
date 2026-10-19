/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Merging Kabmo's stored turns onto JSONL-loaded ones.
 *
 * The two sources see different halves of an attachment: the JSONL recovers a
 * text file's name from the delivered prompt but has no preview or content,
 * while Kabmo row has those display fields but nothing about what omp
 * received. Taking one list over the other dropped whichever entries only
 * existed on the losing side — a dropped `.md` disappeared from a reloaded
 * session as soon as the same turn carried an image.
 */

import { describe, expect, test } from 'bun:test';
import { mergeOmpAttachments, type StoredMessage } from '@/server/lib/omp/session/merge-stored';

function userTurn(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return { id: 'u1', role: 'user', content: 'hello', ...overrides };
}

function storedJson(messages: StoredMessage[]): string {
  return JSON.stringify(messages);
}

describe('mergeOmpAttachments attachments', () => {
  test('keeps both an image from the JSONL and a text file from the store', () => {
    const jsonl = [userTurn({
      attachments: [{ name: 'shot.png', type: 'image/png', preview: 'data:image/png;base64,AAAA' }],
    })];
    const stored = [userTurn({
      attachments: [
        { name: 'notes.md', type: 'text/plain', content: '# hi' },
        { name: 'shot.png', type: 'image/png', preview: 'blob:http://x/1' },
      ],
    })];

    const [merged] = mergeOmpAttachments(jsonl, storedJson(stored));
    expect(merged.attachments?.map((a) => a.name)).toEqual(['shot.png', 'notes.md']);
  });

  test('a text file recovered from the JSONL keeps its name when the store has none', () => {
    const jsonl = [userTurn({
      attachments: [{ name: 'script.py', type: 'text/plain', content: 'x=1' }],
    })];
    const [merged] = mergeOmpAttachments(jsonl, storedJson([userTurn()]));
    expect(merged.attachments).toEqual([{ name: 'script.py', type: 'text/plain', content: 'x=1' }]);
  });

  test('a matching name fills in the fields the JSONL could not carry', () => {
    const jsonl = [userTurn({
      attachments: [{ name: 'shot.png', type: 'image/png', preview: 'data:image/png;base64,AAAA' }],
    })];
    const stored = [userTurn({
      attachments: [{ name: 'shot.png', type: 'image/png', size: 42, content: 'stored' }],
    })];

    const [merged] = mergeOmpAttachments(jsonl, storedJson(stored));
    expect(merged.attachments).toEqual([
      { name: 'shot.png', type: 'image/png', size: 42, content: 'stored', preview: 'data:image/png;base64,AAAA' },
    ]);
  });

  test('an attachment only the store knows about is still shown', () => {
    const jsonl = [userTurn({
      attachments: [{ name: 'shot.png', type: 'image/png', preview: 'data:image/png;base64,AAAA' }],
    })];
    const stored = [userTurn({
      attachments: [
        { name: 'shot.png', type: 'image/png' },
        { name: 'dropped.txt', type: 'text/plain', content: 'kept' },
      ],
    })];

    const [merged] = mergeOmpAttachments(jsonl, storedJson(stored));
    expect(merged.attachments?.map((a) => a.name)).toEqual(['shot.png', 'dropped.txt']);
  });

  test('a turn with no attachments on either side stays attachment-free', () => {
    const [merged] = mergeOmpAttachments([userTurn()], storedJson([userTurn()]));
    expect(merged.attachments).toBeUndefined();
  });

  test('a stored turn that never reached the JSONL is still merged in', () => {
    const [merged] = mergeOmpAttachments([userTurn()], storedJson([userTurn({
      attachments: [{ name: 'notes.md', type: 'text/plain', content: '# hi' }],
    })]));
    expect(merged.attachments).toEqual([{ name: 'notes.md', type: 'text/plain', content: '# hi' }]);
  });
});

describe('mergeOmpAttachments text restoration', () => {
  test('a raw composer turn keeps the text the user typed', () => {
    // The JSONL records only a synthesized `/skill:<name>`; the DB copy has the
    // invocation with its arguments, which is what the user actually typed.
    const jsonl = [userTurn({ content: '/skill:capacity' })];
    const stored = [userTurn({ content: '/skill:capacity summarize this repo' })];
    const [merged] = mergeOmpAttachments(jsonl, storedJson(stored));
    expect(merged.content).toBe('/skill:capacity summarize this repo');
  });

  test('an unrelated stored turn does not overwrite the JSONL text', () => {
    // Turns that cannot be recognized as the same request are left alone; the
    // JSONL keeps what the model was actually sent.
    const jsonl = [userTurn({ content: 'rewritten prompt' })];
    const stored = [userTurn({ content: 'a completely different request' })];
    const [merged] = mergeOmpAttachments(jsonl, storedJson(stored));
    expect(merged.content).toBe('rewritten prompt');
  });

  test('malformed stored JSON leaves the JSONL messages untouched', () => {
    const jsonl = [userTurn()];
    expect(mergeOmpAttachments(jsonl, 'not json')).toBe(jsonl);
    expect(mergeOmpAttachments(jsonl, undefined)).toBe(jsonl);
  });
});
