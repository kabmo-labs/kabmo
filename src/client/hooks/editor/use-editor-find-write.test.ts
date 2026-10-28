/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `useEditorFind` — writing.
 *
 * The rules asserted here are the ones a user notices when they break: a
 * replacement is ONE undoable write that re-aims at the match after the text it
 * just inserted, "replace all" reharness.writes every match, and a replacement that
 * changes nothing harness.writes nothing at all.
 */

import { describe, expect, test } from 'bun:test';

import { createFindHarness } from '@/client/hooks/editor/find-harness.test-util';

const harness = await createFindHarness();
harness.install();

describe('useEditorFind replacing', () => {
  test('replace harness.writes one undoable edit and re-aims past the inserted text', async () => {
    await harness.act(async () => {
      harness.find?.openReplace();
    });
    await harness.act(async () => {
      harness.find?.setReplacement('OMEGA');
    });
    await harness.act(async () => {
      harness.find?.replaceCurrent();
    });

    expect(harness.writes[0].value).toBe('OMEGA beta alpha');
    expect(harness.writes[0].caretStart).toBe(5);
  });

  test('replace all reharness.writes every match', async () => {
    await harness.act(async () => {
      harness.find?.openReplace();
    });
    await harness.act(async () => {
      harness.find?.setReplacement('X');
    });
    await harness.act(async () => {
      harness.find?.replaceAll();
    });

    expect(harness.writes[0].value).toBe('X beta X');
  });

  test('replace all on an unchanged buffer harness.writes nothing', async () => {
    await harness.act(async () => {
      harness.find?.openReplace();
    });
    await harness.act(async () => {
      harness.find?.setQuery('beta');
    });
    await harness.act(async () => {
      harness.find?.setReplacement('beta');
    });
    await harness.act(async () => {
      harness.find?.replaceAll();
    });

    expect(harness.writes).toEqual([]);
  });

  test('replace with no current match harness.writes nothing', async () => {
    await harness.act(async () => {
      harness.find?.openReplace();
    });
    await harness.act(async () => {
      harness.find?.setQuery('zzz');
    });
    await harness.act(async () => {
      harness.find?.replaceCurrent();
    });

    expect(harness.writes).toEqual([]);
  });
});

describe('useEditorFind options', () => {
  test('toggling match case narrows the matches', async () => {
    await harness.act(async () => {
      harness.find?.openFind();
    });
    await harness.act(async () => {
      harness.find?.setQuery('ALPHA');
    });
    expect(harness.find?.matches.length).toBe(2);

    await harness.act(async () => {
      harness.find?.toggleOption('matchCase');
    });

    expect(harness.find?.matches.length).toBe(0);
  });

  test('an invalid pattern is reported as such, not as an empty result', async () => {
    await harness.act(async () => {
      harness.find?.openFind();
    });
    await harness.act(async () => {
      harness.find?.toggleOption('isRegex');
    });
    await harness.act(async () => {
      harness.find?.setQuery('a(');
    });

    expect(harness.find?.invalid).toBe(true);
    expect(harness.find?.matches).toEqual([]);
  });
});

describe('useEditorFind commands', () => {
  test('runCommand routes a find-bar chord to the bar’s own action', async () => {
    await harness.act(async () => {
      harness.find?.runCommand('find');
    });
    expect(harness.find?.open).toBe(true);

    await harness.act(async () => {
      harness.find?.runCommand('replace');
    });
    expect(harness.find?.replaceOpen).toBe(true);
  });

  test('an editor command the bar does not own is ignored, not misrouted', async () => {
    await harness.act(async () => {
      harness.find?.openFind();
    });
    await harness.act(async () => {
      harness.find?.runCommand('deleteLine');
    });

    expect(harness.writes).toEqual([]);
    expect(harness.find?.open).toBe(true);
  });

  test('closing puts focus back on the current match', async () => {
    await harness.act(async () => {
      harness.find?.openFind();
    });
    harness.selections.length = 0;

    await harness.act(async () => {
      harness.find?.close();
    });

    expect(harness.find?.open).toBe(false);
    expect(harness.selections).toEqual([[0, 5, true]]);
  });

  test('a new document re-aims at the top instead of keeping the old offset', async () => {
    await harness.act(async () => {
      harness.find?.openFind();
    });
    await harness.act(async () => {
      harness.find?.step(1);
    });
    expect(harness.find?.currentIndex).toBe(1);

    harness.input.documentKey = 'file-2';
    await harness.rerender();

    expect(harness.find?.currentIndex).toBe(0);
  });
});
