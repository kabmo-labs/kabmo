/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The outline row's hand-off, as the editor sees it.
 *
 * Two properties, and each is a bug this could ship with:
 *
 * - **A request is served ONCE, and only for its own file.** The store is a
 *   process-wide singleton, so a request naming another document must stay
 *   pending; serving it against the file on screen would jump the reader to a
 *   line from a different file. Once served it is cleared, or a remount (a
 *   workspace switch, a panel re-render) re-fires a jump already taken.
 * - **A rendered preview is exited BEFORE the jump is applied.** The prose and
 *   the code surface are different branches, so the surface does not exist yet
 *   on the render that flips the flag — applying the offset there silently does
 *   nothing, which is exactly the "clicked a symbol and nothing happened" bug.
 *
 * Rendered with `h()` against happy-dom, with a stub surface standing in for
 * `CodeSurface` (its own `select`/`revealOffset` are covered by the browser
 * smoke run; what is asserted here is the ORDER and the ONCE).
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useRef, useState } from 'preact/hooks';
import { useLineJump } from '@/client/hooks/editor/use-line-jump';
import { getLineReveal, setLineReveal } from '@/client/lib/line-reveal';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { CodeSurfaceHandle } from '@/client/components/common/code-surface';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  setLineReveal(null);
});

afterAll(() => {
  restoreDomGlobals();
});

interface ProbeState {
  /** `['select', start, end]` and `['reveal', offset]`, in the order they ran. */
  calls: Array<[string, number, number]>;
  exitPreview: () => void;
  surfaceReady: () => boolean;
}

/**
 * A stand-in editor: the surface ref is filled by an effect, so the ref is
 * genuinely null on the render that flips the preview flag — the ordering the
 * real component has.
 */
function Probe({ preview, path, onState }: { preview: boolean; path: string; onState: (state: ProbeState) => void }) {
  const [isPreview, setIsPreview] = useState(preview);
  const surfaceRef = useRef<CodeSurfaceHandle | null>(null);
  // A ref, not a fresh array: the probe re-renders when the preview flips, and
  // a per-render array would hand the test the previous render's list.
  const callsRef = useRef<Array<[string, number, number]>>([]);

  useLineJump({
    path,
    content: 'line one\nline two\nline three',
    ready: true,
    surfaceRef,
    isPreview,
    exitPreview: () => setIsPreview(false),
  });

  // The surface exists only while the source is shown, exactly as the editor's
  // branch does — so a jump applied before the flag flips hits a null ref.
  const showSurface = !isPreview;
  const attach = () => {
    if (!showSurface) {
      surfaceRef.current = null;
      return;
    }
    surfaceRef.current = {
      getSelection: () => null,
      select: (start: number, end: number) => callsRef.current.push(['select', start, end]),
      applyDocument: () => {},
      runCommand: () => {},
      revealOffset: (offset: number) => callsRef.current.push(['reveal', offset, offset]),
    };
  };

  onState({
    calls: callsRef.current,
    exitPreview: () => setIsPreview(false),
    surfaceReady: () => surfaceRef.current !== null,
  });

  return h('div', { ref: attach });
}

async function mount(preview: boolean, path = 'src/a.ts'): Promise<ProbeState> {
  let state: ProbeState | null = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(Probe, { preview, path, onState: (next: ProbeState) => { state = next; } }), container);
  });
  if (!state) throw new Error('probe did not render');
  return state;
}

describe('useLineJump', () => {
  test('a request for this file places the caret and reveals the line', async () => {
    const probe = await mount(false);

    await act(async () => {
      setLineReveal({ path: 'src/a.ts', line: 3 });
    });

    expect(probe.calls).toEqual([
      ['select', 18, 18],
      ['reveal', 18, 18],
    ]);
    expect(getLineReveal()).toBeNull();
  });

  test('a request for another file stays pending', async () => {
    const probe = await mount(false);

    await act(async () => {
      setLineReveal({ path: 'src/other.ts', line: 2 });
    });

    expect(probe.calls).toEqual([]);
    expect(getLineReveal()).toEqual({ path: 'src/other.ts', line: 2 });
  });

  test('a row that names a column selects the NAME, and still scrolls the line', async () => {
    const probe = await mount(false);

    // "two" is the second word of line 2: 4 characters in, 3 long.
    await act(async () => {
      setLineReveal({ path: 'src/a.ts', line: 2, column: 5, length: 3 });
    });

    expect(probe.calls).toEqual([
      ['select', 13, 16],
      ['reveal', 9, 9],
    ]);
  });

  test('a stale column is clamped to the live line', async () => {
    const probe = await mount(false);

    // The buffer's second line is `line two`; a column past its end (an edit
    // shortened the line) must land at the end, never into the next line.
    await act(async () => {
      setLineReveal({ path: 'src/a.ts', line: 2, column: 60, length: 3 });
    });

    expect(probe.calls).toEqual([
      ['select', 17, 17],
      ['reveal', 9, 9],
    ]);
  });

  test('a served request is not re-applied on a re-render', async () => {
    const probe = await mount(false);

    await act(async () => {
      setLineReveal({ path: 'src/a.ts', line: 2 });
    });
    expect(probe.calls).toHaveLength(2);

    // A later render of the same tree, with the store already cleared.
    await act(async () => {
      setLineReveal({ path: 'src/a.ts', line: 2 });
      setLineReveal(null);
    });
    expect(probe.calls).toHaveLength(2);
  });

  test('a jump from a rendered preview lands after the source surface mounts', async () => {
    const probe = await mount(true);

    await act(async () => {
      setLineReveal({ path: 'src/a.ts', line: 2 });
    });
    // The preview was left, and the surface is now mounted.
    expect(probe.surfaceReady()).toBe(true);
    // And the jump was applied — not lost to a null ref on the flip render.
    expect(probe.calls).toEqual([
      ['select', 9, 9],
      ['reveal', 9, 9],
    ]);
  });
});
