/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The panel a reader opens when a harness update is running (or just failed).
 *
 * The complaint it answers was concrete: press Update on `claude`, and the card
 * showed a spinner with no way to see what the install was printing — so a
 * failure said "update failed" with the reason already gone. These cases pin the
 * three things the panel must state: every step and its command, the streamed
 * output, and the finished run's own sentence.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { UpdateLogDialog } from '@/client/components/layout/session-sidebar/about-modal/UpdateLogDialog';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { HarnessUpdateJob } from '@/shared/types/harness-update';

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterAll(() => {
  restoreDomGlobals();
});

let container: HTMLElement | null = null;

afterEach(() => {
  if (container) act(() => render(null, container!));
  container?.remove();
  container = null;
  for (const node of Array.from(document.body.children)) node.remove();
});

function job(overrides: Partial<HarnessUpdateJob> = {}): HarnessUpdateJob {
  return {
    harness: 'claude',
    label: 'claude',
    startedAt: Date.now(),
    finishedAt: null,
    pid: 4242,
    steps: [
      {
        part: 'adapter',
        command: 'npm install -g @agentclientprotocol/claude-agent-acp@0.102.0',
        argv: ['npm', 'install', '-g', '@agentclientprotocol/claude-agent-acp@0.102.0'],
        state: 'running',
        code: null,
      },
    ],
    output: '',
    ok: null,
    message: null,
    applied: false,
    repointed: null,
    ...overrides,
  };
}

/** Mount the panel and hand back its dialog element. */
function mountPanel(record: HarnessUpdateJob, onClose: () => void = () => {}): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => render(<UpdateLogDialog job={record} onClose={onClose} />, container!));
  const panel = document.querySelector('[role="dialog"]');
  if (!panel) throw new Error('the log panel did not mount');
  return panel as HTMLElement;
}

describe('UpdateLogDialog', () => {
  test('a running step shows its command and says it is waiting for output', () => {
    const panel = mountPanel(job());
    expect(panel.textContent).toContain('Updating claude');
    expect(panel.textContent).toContain('Installing…');
    expect(panel.textContent).toContain('adapter');
    // The command is the reader's way to repeat a step by hand after a failure.
    expect(panel.textContent).toContain('npm install -g @agentclientprotocol/claude-agent-acp@0.102.0');
    expect(panel.textContent).toContain('Waiting for output…');
  });

  test('the streamed output is rendered verbatim', () => {
    const panel = mountPanel(job({ output: 'added 1 package in 3s\nnpm warn deprecated x' }));
    expect(panel.querySelector('pre')?.textContent).toContain('added 1 package in 3s');
  });

  test('a failed step names its exit code, and the run its sentence', () => {
    const panel = mountPanel(job({
      finishedAt: Date.now(),
      pid: null,
      ok: false,
      applied: true,
      message: 'claude update failed (exit 3)',
      output: 'boom',
      steps: [{
        part: 'Claude Code',
        command: 'claude update',
        argv: ['claude', 'update'],
        state: 'failed',
        code: 3,
      }],
    }));
    expect(panel.textContent).toContain('Failed');
    expect(panel.textContent).toContain('claude update');
    expect(panel.textContent).toContain('exit 3');
    expect(panel.textContent).toContain('claude update failed (exit 3)');
  });

  test('a finished run with no output says so instead of showing an empty box', () => {
    const panel = mountPanel(job({ finishedAt: Date.now(), pid: null, ok: true, message: 'claude updated (adapter)' }));
    expect(panel.textContent).toContain('The commands printed nothing.');
    expect(panel.textContent).toContain('claude updated (adapter)');
    expect(panel.textContent).toContain('Finished');
  });

  test('the close control asks to close', () => {
    let closed = 0;
    const panel = mountPanel(job(), () => { closed += 1; });
    const close = panel.querySelector<HTMLButtonElement>('button[aria-label="Close"]')
      ?? panel.querySelector<HTMLButtonElement>('button');
    expect(close).not.toBeNull();
    act(() => close!.click());
    expect(closed).toBe(1);
  });
});
