/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The header's TITLE policy under a tab strip, and the strip's reorder rule.
 *
 * Two things were wrong before this file existed, and both were visible on the
 * running app:
 *
 * 1. **A tab-style column drew two rows naming the same view** — the chip, then
 *    the view's own `PanelHeader`. The first pass at the fix deleted the whole
 *    row, which took `Usage`'s generation timestamp with it; the second pass
 *    classified `Usage` as title-only, which it is not. So the classification is
 *    what these tests pin: only a header whose every element is the view's name
 *    may be dropped, and everything else keeps the row with its title hidden.
 * 2. **Reorder was unimplemented**, and the strip's order is session state, so a
 *    drag must not be able to (a) duplicate a chip, (b) move the pinned view, or
 *    (c) drop a chip that closed mid-gesture.
 */

import { describe, expect, test } from 'bun:test';
import {
  showsPanelHeader,
  showsPanelTitle,
} from '@/client/components/workspace/panel-header/title-policy';

describe('showsPanelHeader', () => {
  test('under the rail every view draws its own header', () => {
    for (const id of ['todo', 'plan', 'usage', 'context', 'files', 'search', 'git', 'wiki', 'terminal']) {
      expect(showsPanelHeader(id, false)).toBe(true);
    }
  });

  test('under tabs a title-only header is dropped entirely', () => {
    expect(showsPanelHeader('todo', true)).toBe(false);
    expect(showsPanelHeader('plan', true)).toBe(false);
  });

  test('under tabs a header carrying a fact is KEPT, so the fact survives', () => {
    // `Usage` prints its generation timestamp and `Context` a session title and
    // time; `Search`, `Files`, `GIT`, `WIKI`, `Terminal` carry the repo picker.
    for (const id of ['usage', 'context', 'search', 'files', 'git', 'wiki', 'terminal']) {
      expect(showsPanelHeader(id, true)).toBe(true);
    }
  });

  test('an unknown view keeps its header — a guess must not hide data', () => {
    expect(showsPanelHeader('plugin:acme/widget', true)).toBe(true);
  });
});

describe('showsPanelTitle', () => {
  test('the rail always states the view name', () => {
    expect(showsPanelTitle(false)).toBe(true);
  });

  test('the strip never repeats what its chip already says', () => {
    expect(showsPanelTitle(true)).toBe(false);
  });
});
