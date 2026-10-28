/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The New Chat seed divider.
 *
 * Two properties matter and both are asserted here, because each is silent when
 * it breaks:
 *
 *  - the divider must sit on its OWN line after a blank one, or markdown reads
 *    it as a setext H2 underline and the seeded message renders as a heading;
 *  - it must come AFTER the seed, so a leading `/command` still starts the
 *    prompt — omp parses the command token at the start, and branching a chat
 *    from a builtin such as `/usage` is legitimate.
 */

import { describe, expect, test } from 'bun:test';

import { NEW_CHAT_SEED_DIVIDER, seedNewChatDraft } from '@/shared/lib/chat/new-chat-seed';

describe('seedNewChatDraft', () => {
  test('separates the seeded message from the room to type', () => {
    expect(seedNewChatDraft('explain the loader')).toBe('explain the loader\n\n---\n');
  });

  test('keeps a leading command at the start of the prompt', () => {
    // omp parses the command token at the START of the prompt, so the divider
    // must never be prefixed — `/usage` has to stay the first thing it sees.
    const draft = seedNewChatDraft('/usage');
    expect(draft.startsWith('/usage')).toBe(true);
    expect(draft).toBe('/usage\n\n---\n');
  });

  test('the divider is its own line after a blank one, never a setext heading', () => {
    const draft = seedNewChatDraft('a message');
    expect(draft).toContain(`\n\n${NEW_CHAT_SEED_DIVIDER}\n`);
    // A `---` directly under text is an H2 underline in markdown.
    expect(draft).not.toContain(`a message\n---`);
  });

  test('an empty or whitespace-only seed opens an empty draft, not a lone divider', () => {
    expect(seedNewChatDraft('')).toBe('');
    expect(seedNewChatDraft('   \n  ')).toBe('');
  });

  test('trims the seed so the divider does not float off a trailing blank line', () => {
    expect(seedNewChatDraft('  spaced  \n\n')).toBe('spaced\n\n---\n');
  });
});
