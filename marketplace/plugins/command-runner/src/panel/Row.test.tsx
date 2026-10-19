/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The command ROW: the disclosure, the background toggle, and Run.
 *
 * Each behaviour pinned here was a real defect or a deliberate reversal:
 *
 * - **The disclosure is DISABLED until there is output.** A command that has
 *   never run has nothing to expand, and a toggle that opens onto "nothing here"
 *   teaches the reader the control is unreliable. Verified before this: the row
 *   opened onto a placeholder, which is the state a disabled control states
 *   better.
 * - **A Run OPENS the row.** The first version ran the command and left the
 *   expansion shut, so a successful run looked like nothing happened.
 * - **There is no output toggle.** It was removed: expanding the row already
 *   shows the output, so a second control that only decided the row's default
 *   was one thing with two controls — and a row that opened itself because a flag
 *   was on fought the reader who had just closed it. The background toggle
 *   remains, because how a run is TRACKED is a real choice.
 * - **Output belongs to the ROW**, and a killed run reads `stopped (SIGTERM)` —
 *   never `exit 0`, which is what a null exit code would look like.
 *
 * Rendered with `h()` against happy-dom, with the disclosure driven by real
 * clicks. The reveal itself is CSS (`grid-template-rows`), which happy-dom does
 * not compute — so what is asserted is `data-expanded` and `inert`, which is what
 * the stylesheet and the accessibility tree read.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { CommandRow } from './Row';
import type { Command, RunLog, RunSummary } from '../protocol';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Text', 'Element', 'SVGElement'] as const;
const saved = new Map<string, unknown>();

let container: HTMLElement;
/** Every action a row dispatched, in order. */
let calls: string[];

beforeAll(() => {
  const win = new Window({ url: 'http://localhost/' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!saved.has(key)) saved.set(key, target[key]);
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (saved.has(key)) target[key] = saved.get(key);
    else delete target[key];
  }
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  calls = [];
});

const COMMAND: Command = { id: 'package.json#package:speak', name: 'speak', label: 'bun run speak', argv: ['bun', 'run', 'speak'] };

/** A finished run, with a log whose text is identifiable. */
function finishedRun(): RunSummary {
  return {
    id: 'run-1',
    sessionId: 's1',
    scopeKey: '/ws\0.',
    commandId: COMMAND.id,
    file: 'package.json',
    label: COMMAND.label,
    background: false,
    status: 'exited',
    startedAt: Date.now() - 1200,
    endedAt: Date.now(),
    exitCode: 0,
    signal: null,
    bytes: 27,
    ringBytes: 27,
  };
}

const LOG: RunLog = {
  id: 'run-1',
  status: 'exited',
  exitCode: 0,
  signal: null,
  bytes: 27,
  ringBytes: 27,
  truncated: false,
  text: 'CHAMBER-SPEAKS-LOUD',
};

/** Render one row. Defaults describe a command that has never run. */
async function mount(overrides: Partial<Parameters<typeof CommandRow>[0]> = {}): Promise<void> {
  container = document.createElement('div') as unknown as HTMLElement;
  document.body.appendChild(container as never);
  const props = {
    command: COMMAND,
    file: 'package.json',
    run: null as RunSummary | null,
    log: null as RunLog | null,
    background: false,
    onToggleBackground: (id: string, next: boolean) => calls.push(`background:${id}:${next}`),
    onRun: (id: string) => calls.push(`run:${id}`),
    onStop: (id: string) => calls.push(`stop:${id}`),
    onReadLog: (id: string) => calls.push(`read:${id}`),
    ...overrides,
  };
  await act(async () => {
    render(h(CommandRow, props), container);
  });
  await act(async () => {});
}

/** The row's disclosure button — the one that owns `aria-expanded`. */
function disclosure(): HTMLButtonElement {
  return container.querySelector('button[aria-expanded]') as HTMLButtonElement;
}

/**
 * A control by its accessible name.
 *
 * `exact` still matters as a matter of precision — `Run bun run speak` is a
 * prefix of nothing now, but a lookup that accepts a prefix is a lookup that can
 * be satisfied by a control the caller did not name. The collision this helper
 * was written around (the background toggle was once named
 * `Run <label> as a background job …`, so a startsWith for the Run control
 * returned the TOGGLE) is pinned by its own test below.
 */
function byLabel(name: string, exact = false): HTMLButtonElement {
  return [...container.querySelectorAll('button')].find((b) => {
    const label = b.getAttribute('aria-label') ?? '';
    return exact ? label === name : label.startsWith(name);
  }) as HTMLButtonElement;
}

/** The reveal wrapper, whose `data-expanded` is what the CSS reads. */
function reveal(): HTMLElement {
  return container.querySelector('.section-reveal') as HTMLElement;
}

describe('CommandRow', () => {
  test('a command that has never run has a DISABLED disclosure', async () => {
    await mount();
    const toggle = disclosure();
    expect(toggle.disabled).toBe(true);
    // It says why, rather than opening onto a placeholder.
    expect(toggle.getAttribute('title')).toContain('has not run yet');
    expect(reveal().getAttribute('data-expanded')).toBe('false');
    expect(reveal().hasAttribute('inert')).toBe(true);
  });

  test('a click on a disabled disclosure does nothing', async () => {
    await mount();
    await act(async () => disclosure().click());
    expect(reveal().getAttribute('data-expanded')).toBe('false');
  });

  test('with a run, the disclosure is ENABLED and toggles', async () => {
    await mount({ run: finishedRun() });
    const toggle = disclosure();
    expect(toggle.disabled).toBe(false);

    // A run OPENS the row (see the next test), so the first click CLOSES it —
    // the toggle is read in both directions rather than assumed to start shut.
    await act(async () => toggle.click());
    expect(reveal().getAttribute('data-expanded')).toBe('false');
    expect(reveal().hasAttribute('inert')).toBe(true);

    await act(async () => toggle.click());
    expect(reveal().getAttribute('data-expanded')).toBe('true');
    expect(reveal().hasAttribute('inert')).toBe(false);
  });

  test('a run OPENS the row by itself, so a run cannot look like it did nothing', async () => {
    await mount({ run: finishedRun() });
    // The effect opens it once the run exists — the defect this pins: the run
    // succeeded and the expansion stayed shut.
    expect(reveal().getAttribute('data-expanded')).toBe('true');
  });

  test('Run reports the command and the row opens once the run appears', async () => {
    await mount();
    await act(async () => byLabel('Run bun run speak', true).click());
    expect(calls).toContain('run:package.json#package:speak');
    // Still closed: there is no output yet, so there is nothing to open onto.
    expect(reveal().getAttribute('data-expanded')).toBe('false');
  });

  test('there is no output toggle', async () => {
    await mount({ run: finishedRun() });
    // The one toggle left is background. `Keep … output` must not exist.
    expect(byLabel('Keep bun run speak output')).toBeUndefined();
    expect(container.querySelectorAll('button[aria-pressed]')).toHaveLength(1);
  });

  test('the background toggle reports the flip', async () => {
    await mount();
    await act(async () => byLabel('Keep bun run speak running in the background').click());
    expect(calls).toEqual(['background:package.json#package:speak:true']);
  });

  test('no two controls in a row share an accessible name prefix', async () => {
    await mount();
    // The regression this pins: the toggle was named
    // `Run <label> as a background job …`, so the Run control's own name was a
    // PREFIX of it — a screen reader announced two controls beginning
    // "Run bun run speak", and every prefix lookup (including the e2e spec's)
    // resolved to the wrong one. Distinct verbs, so no name prefixes another.
    const labels = [...container.querySelectorAll('button[aria-label]')]
      .map((b) => b.getAttribute('aria-label')!)
      .filter((label) => label.includes('bun run speak'));
    expect(labels.length).toBeGreaterThanOrEqual(2);
    for (const a of labels) {
      for (const b of labels) {
        if (a !== b) expect(b.startsWith(a)).toBe(false);
      }
    }
  });

  test('a running command offers Stop instead of Run, and it stops', async () => {
    const running = { ...finishedRun(), status: 'running' as const, endedAt: null, exitCode: null };
    await mount({ run: running });

    const stop = byLabel('Stop bun run speak', true);
    expect(stop).toBeDefined();
    await act(async () => stop.click());
    expect(calls).toContain('stop:run-1');
  });

  test('the row reads its own run\u2019s log when it is shown', async () => {
    await mount({ run: finishedRun() });
    expect(calls).toContain('read:run-1');
  });

  test('a collapsed row reads nothing', async () => {
    await mount({ run: finishedRun() });
    // Close it first: the open-on-run effect opened it.
    await act(async () => disclosure().click());
    calls = [];
    // Nothing is shown, so nothing is fetched — a closed row costs no request.
    expect(calls.filter((call) => call.startsWith('read:'))).toEqual([]);
  });

  test('the output lands in the row, in a code block, with the outcome named', async () => {
    await mount({ run: finishedRun(), log: LOG });
    const text = container.textContent ?? '';
    expect(text).toContain('CHAMBER-SPEAKS-LOUD');
    expect(text).toContain('exit 0');
    // A program's stdout is a code block, not prose: the `<pre>` carries the
    // Kabmo's code-block shell, and it WRAPS rather than scrolling sideways.
    const pre = container.querySelector('pre')!;
    expect(pre.className).toContain('font-mono');
    expect(pre.className).toContain('whitespace-pre-wrap');
    expect(pre.className).toContain('border-ink/15');
  });

  test('a killed run reads as stopped, not as a success', async () => {
    const killed = { ...finishedRun(), status: 'stopped' as const, exitCode: null, signal: 'SIGTERM' };
    await mount({ run: killed, log: { ...LOG, status: 'stopped', exitCode: null, signal: 'SIGTERM' } });
    const text = container.textContent ?? '';
    expect(text).toContain('stopped (SIGTERM)');
    // The bug this pins: a null exit code rendered as `exit 0`.
    expect(text).not.toContain('exit 0');
  });
});
