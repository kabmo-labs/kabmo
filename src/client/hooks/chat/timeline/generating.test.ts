/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The generating-state contract: the local flag and the OWNERSHIP flag are two
 * different things, and conflating them is what painted the run footer over an
 * empty row on every prompt.
 *
 * `isGenerating` means "this page is rendering a run's live UI" and is set by
 * the mount probe that resumes a live run as well as by a send. `ownRun` means
 * "this page DISPATCHED the run", and it is the term `timelineRunning` adds to
 * the server's `stream` row — the row arrives ~120-250 ms after the optimistic
 * rows are armed, and without this term the run read as already settled for
 * that window.
 *
 * Both directions are pinned here: an adopted run (no `owned`) must NOT claim
 * ownership, or a session opened mid-stream would discard its own transcript;
 * and a send (`owned`) must, or the footer flashes again.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { h as PreactH, render as PreactRender } from 'preact';
import type { act as PreactAct } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { useGeneratingState as UseGeneratingState, GeneratingState } from '@/client/hooks/chat/timeline/generating';

let useGeneratingState: typeof UseGeneratingState;
let h: typeof PreactH;
let render: typeof PreactRender;
let act: typeof PreactAct;

beforeAll(async () => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  // Static imports cannot work here: Preact binds its environment at module
  // evaluation time, so these must load after the DOM globals are installed.
  ({ useGeneratingState } = await import('@/client/hooks/chat/timeline/generating'));
  ({ h, render } = await import('preact'));
  ({ act } = await import('preact/test-utils'));
});

afterAll(() => {
  restoreDomGlobals();
});

interface ProbeProps {
  holder: { current: GeneratingState | null };
}

function Probe({ holder }: ProbeProps) {
  holder.current = useGeneratingState();
  return null;
}

async function mountProbe(): Promise<{ state: () => GeneratingState; run: (fn: () => void) => Promise<void> }> {
  const holder: ProbeProps['holder'] = { current: null };
  const node = document.createElement('div');
  document.body.appendChild(node);
  await act(async () => { render(h(Probe, { holder }), node); });
  return {
    state: () => holder.current!,
    run: async (fn: () => void) => { await act(async () => { fn(); }); },
  };
}

describe('useGeneratingState', () => {
  test('a send claims ownership and both flags read true', async () => {
    const probe = await mountProbe();
    expect(probe.state().isGenerating).toBe(false);
    expect(probe.state().ownRun).toBe(false);

    await probe.run(() => probe.state().setGenerating(true, true));
    expect(probe.state().isGenerating).toBe(true);
    expect(probe.state().ownRun).toBe(true);
    // The ref mirror the session-load guard reads must agree with the state.
    expect(probe.state().ownRunRef.current).toBe(true);
  });

  test('an ADOPTED run sets the generating UI without claiming ownership', async () => {
    // The mount probe that resumes a live run's UI calls `setGenerating(true)`
    // with no `owned`: the run is real and must be rendered, but this page did
    // not dispatch it — claiming it would make the session-load guard discard
    // the transcript of the session being opened mid-stream.
    const probe = await mountProbe();
    await probe.run(() => probe.state().setGenerating(true));
    expect(probe.state().isGenerating).toBe(true);
    expect(probe.state().ownRun).toBe(false);
    expect(probe.state().ownRunRef.current).toBe(false);
  });

  test('a settle releases ownership, so the next adopted run cannot inherit it', async () => {
    const probe = await mountProbe();
    await probe.run(() => probe.state().setGenerating(true, true));
    await probe.run(() => probe.state().setGenerating(false));
    expect(probe.state().isGenerating).toBe(false);
    expect(probe.state().ownRun).toBe(false);
    // A later ADOPTED run must not inherit the previous run's ownership.
    await probe.run(() => probe.state().setGenerating(true));
    expect(probe.state().ownRun).toBe(false);
  });
});
