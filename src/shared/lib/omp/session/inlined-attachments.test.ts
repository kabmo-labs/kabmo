/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Recovery of inlined text attachments from a delivered prompt.
 *
 * The composer does not send a text file as data — it appends the file to the
 * prompt as `Attached file: <name>` plus a fenced block, and that composed
 * prompt is the only record omp keeps. `stripInlinedTextAttachments` removes
 * those blocks so the timeline shows the user's own words, which also discards
 * the names: a reloaded session then showed an image chip and nothing for the
 * `.md`/`.py`/`.json` that rode beside it.
 *
 * These tests pin the round trip, including the adversarial cases the format
 * allows: content that itself contains a run of backticks (the fence grows to
 * outrun it) and content that literally reads `Attached file:`.
 */

import { describe, expect, test } from 'bun:test';
import {
  extractInlinedTextAttachments,
  stripInlinedTextAttachments,
} from '@/shared/lib/omp/session/parse-message-blocks';

describe('extractInlinedTextAttachments', () => {
  test('recovers a file the composer appended to a prompt', () => {
    const prompt = 'explain this\n\nAttached file: script.py\n```python\nx=1\n```';
    expect(extractInlinedTextAttachments(prompt)).toEqual([{ name: 'script.py', content: 'x=1' }]);
    // The visible text is the user's own words; the block is not shown twice.
    expect(stripInlinedTextAttachments(prompt)).toBe('explain this');
  });

  test('recovers an attach-only prompt, whose visible text is empty', () => {
    const prompt = 'Attached file: attachment-test.md\n```markdown\n# Title\n\nbody\n\n```';
    // Trailing newline before the closing fence belongs to the content: the
    // composer writes `<content>\n<fence>`.
    expect(extractInlinedTextAttachments(prompt)).toEqual([
      { name: 'attachment-test.md', content: '# Title\n\nbody\n' },
    ]);
    expect(stripInlinedTextAttachments(prompt)).toBe('');
  });

  test('recovers every file when several were attached', () => {
    const prompt = 'q\n\nAttached file: a.md\n```markdown\nA\n```\n\nAttached file: b.py\n```python\nB\n```';
    expect(extractInlinedTextAttachments(prompt)).toEqual([
      { name: 'a.md', content: 'A' },
      { name: 'b.py', content: 'B' },
    ]);
  });

  test('leaves a prompt with no attachments alone', () => {
    expect(extractInlinedTextAttachments('just a normal message')).toEqual([]);
    expect(stripInlinedTextAttachments('just a normal message')).toBe('just a normal message');
  });

  test('does not mistake prose that merely mentions the header', () => {
    // No fence follows, so this is not a block — it is the user talking.
    expect(extractInlinedTextAttachments('I saw an Attached file: note in the docs')).toEqual([]);
  });

  test('keeps content that contains a backtick run', () => {
    // `fenceForContent` grows the fence past the longest run in the content, so
    // the inner ``` must survive as content and the outer ```` is the close.
    const prompt = 'q\n\nAttached file: nested.md\n````markdown\nbefore\n```\ncode\n```\nafter\n````';
    expect(extractInlinedTextAttachments(prompt)).toEqual([
      { name: 'nested.md', content: 'before\n```\ncode\n```\nafter' },
    ]);
  });

  test('keeps content that literally contains the header', () => {
    const prompt = 'q\n\nAttached file: tricky.md\n````markdown\nAttached file: fake.txt\n```\ninner\n```\n````';
    expect(extractInlinedTextAttachments(prompt)).toEqual([
      { name: 'tricky.md', content: 'Attached file: fake.txt\n```\ninner\n```' },
    ]);
  });

  test('an unterminated block yields nothing rather than a partial read', () => {
    expect(extractInlinedTextAttachments('q\n\nAttached file: open.md\n```markdown\nno close')).toEqual([]);
  });
});
