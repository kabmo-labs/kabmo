/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The write-feedback contract every settings pane now shares.
 *
 * This exists because the panes used to paint "Saved successfully" the moment
 * the button was pressed — before the request answered — so a refused write (a
 * duplicate preset name, a read-only native file, a validator rejecting the
 * draft) showed success over a row that had not changed. The badge is now driven
 * by the outcome and nothing else, and a refusal keeps the server's sentence.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useWriteFeedback, type WriteFeedback } from '@/client/hooks/settings/write-feedback';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { WriteOutcome } from '@/shared/types';

let container: HTMLElement | null = null;
let feedback: WriteFeedback | null = null;

function Probe() {
  feedback = useWriteFeedback();
  return h('div', null, feedback.saving ? 'saving' : feedback.saved ? 'saved' : 'idle');
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
  container = null;
  feedback = null;
});

afterAll(() => {
  restoreDomGlobals();
});

async function mount(): Promise<void> {
  container = document.body.appendChild(document.createElement('div'));
  await act(async () => { render(h(Probe, {}), container as HTMLElement); });
}

/** Run one write and drain its promise chain plus the resulting renders. */
async function run(action: () => Promise<WriteOutcome>): Promise<boolean> {
  let ok = false;
  await act(async () => {
    const pending = feedback!.run(action);
    ok = await pending;
  });
  return ok;
}

describe('useWriteFeedback', () => {
  test('a landed write flashes saved instead of trusting the click', async () => {
    await mount();
    expect(await run(async () => ({ ok: true }))).toBe(true);
    expect(feedback?.saved).toBe(true);
    expect(feedback?.error).toBeNull();
    expect(feedback?.saving).toBe(false);
  });

  test('a refusal keeps the server’s sentence and shows no success', async () => {
    await mount();
    expect(await run(async () => ({ ok: false, error: 'A preset named “cheap” already exists' }))).toBe(false);
    expect(feedback?.saved).toBe(false);
    expect(feedback?.error).toBe('A preset named “cheap” already exists');
  });

  test('a refusal without a sentence still says something actionable', async () => {
    await mount();
    await run(async () => ({ ok: false }));
    expect(feedback?.error).toBe('The server refused the write.');
  });

  test('a thrown write is reported rather than escaping to the console', async () => {
    await mount();
    expect(await run(async () => { throw new Error('network down'); })).toBe(false);
    expect(feedback?.error).toBe('network down');
    expect(feedback?.saving).toBe(false);
  });

  test('a later success clears the previous refusal', async () => {
    await mount();
    await run(async () => ({ ok: false, error: 'first refusal' }));
    await run(async () => ({ ok: true }));
    expect(feedback?.error).toBeNull();
    expect(feedback?.saved).toBe(true);
  });

  test('dismissError clears the sentence without clearing a success', async () => {
    await mount();
    await run(async () => ({ ok: false, error: 'nope' }));
    await act(async () => { feedback?.dismissError(); });
    expect(feedback?.error).toBeNull();
  });
});
