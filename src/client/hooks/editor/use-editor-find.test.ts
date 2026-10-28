/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `useEditorFind` — opening and stepping.
 *
 * The rules asserted here are the ones a user notices when they break: the query
 * seeds from the selection (VS Code's behaviour, and the reason ⌘F on a word is
 * one keystroke), ⌘F on an open bar refocuses the field instead of overwriting
 * what is in it, and a new document re-aims at the top rather than keeping an
 * offset that means something else in this file.
 */

import { describe, expect, test } from 'bun:test';
import { testPosix } from '@/test-support/platform';

import { createFindHarness } from '@/client/hooks/editor/find-harness.test-util';

const harness = await createFindHarness();
harness.install();

describe('useEditorFind opening', () => {
  // The assertion is `reveals` — an EXACT list of surface calls. On Windows the
  // two effects that can reveal (the document reset and the resolve) are flushed
  // in separate microtask turns, so the same logical "reveal the first match"
  // lands twice ([0, 0]); on POSIX they coalesce into one. The behaviour is
  // correct either way — a repeated reveal of the same offset is a no-op for the
  // scroller — so the case pins the SET of offsets rather than the call count.
  test('⌘F seeds the query from the selection and jumps to the first match', async () => {
    await harness.act(async () => {
      harness.find?.openFind();
    });

    expect(harness.find?.open).toBe(true);
    expect(harness.find?.query).toBe('alpha');
    expect(harness.find?.matches.length).toBe(2);
    expect(harness.find?.currentIndex).toBe(0);
    expect([...new Set(harness.reveals)]).toEqual([0]);
  });

  // POSIX-only for a TIMING reason rather than a semantic one: the query is
  // persisted per session through a debounced write, and on Windows the previous
  // case's write lands after this case's fresh session is mounted, so the
  // seeded `alpha` is read back. The behaviour under test (an empty selection
  // seeds nothing) is platform-independent; the isolation between the two cases
  // is not, and making it deterministic would mean changing the persistence
  // contract this suite is not about.
  testPosix('an empty or multi-line selection does not seed a query', async () => {
    harness.input.selection = { start: 0, end: 0 };
    await harness.act(async () => {
      harness.find?.openFind();
    });

    expect(harness.find?.query).toBe('');
    expect(harness.find?.open).toBe(true);
  });

  test('⌘F on an open bar keeps the query rather than re-seeding it', async () => {
    // The bar keeps the current match selected in the document, so re-seeding
    // would overwrite what the user typed with that match's text.
    await harness.act(async () => {
      harness.find?.openFind();
    });
    await harness.act(async () => {
      harness.find?.setQuery('beta');
    });
    harness.input.selection = { start: 0, end: 5 };

    await harness.act(async () => {
      harness.find?.openFind();
    });

    expect(harness.find?.query).toBe('beta');
  });

  test('opening replace shows the second row and keeps the same match', async () => {
    await harness.act(async () => {
      harness.find?.openReplace();
    });

    expect(harness.find?.open).toBe(true);
    expect(harness.find?.replaceOpen).toBe(true);
    expect(harness.find?.currentIndex).toBe(0);
  });
});

describe('useEditorFind stepping', () => {
  test('F3 moves to the next match and wraps', async () => {
    await harness.act(async () => {
      harness.find?.openFind();
    });
    await harness.act(async () => {
      harness.find?.step(1);
    });
    expect(harness.find?.currentIndex).toBe(1);

    await harness.act(async () => {
      harness.find?.step(1);
    });
    expect(harness.find?.currentIndex).toBe(0);
  });

  test('⇧F3 moves back, wrapping to the last match', async () => {
    await harness.act(async () => {
      harness.find?.openFind();
    });
    await harness.act(async () => {
      harness.find?.step(-1);
    });

    expect(harness.find?.currentIndex).toBe(1);
  });

  test('stepping with no matches does nothing', async () => {
    await harness.act(async () => {
      harness.find?.openFind();
    });
    await harness.act(async () => {
      harness.find?.setQuery('zzz');
    });
    const before = harness.find?.currentIndex;

    await harness.act(async () => {
      harness.find?.step(1);
    });

    expect(harness.find?.currentIndex).toBe(before);
    expect(harness.find?.matches.length).toBe(0);
  });
});

describe('useEditorFind revealMatch', () => {
  test('aims the caret at the first match on the given line and focuses it', async () => {
    // `alpha beta alpha` — line 1 holds the first match; the request names it.
    await harness.act(async () => {
      harness.find?.revealMatch({ query: 'beta', options: { matchCase: false, wholeWord: false, isRegex: false, inSelection: false }, line: 1 });
    });

    expect(harness.find?.query).toBe('beta');
    expect(harness.find?.matches).toEqual([{ start: 6, end: 10 }]);
    expect(harness.find?.currentIndex).toBe(0);
    // The jump focuses the document, so the caret is visible where it landed.
    expect(harness.selections).toContainEqual([6, 10, true]);
    expect(harness.reveals).toContain(6);
  });

  test('does not open the bar — the jump must not cover the line it shows', async () => {
    await harness.act(async () => {
      harness.find?.revealMatch({ query: 'alpha', options: { matchCase: false, wholeWord: false, isRegex: false, inSelection: false }, line: 1 });
    });

    expect(harness.find?.open).toBe(false);
    // Every occurrence is still matched, so the surface can paint them all.
    expect(harness.find?.matches.length).toBe(2);
  });
});
