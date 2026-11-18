/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `window.__kabmoRunCommand` — the native menu's only route into the catalog.
 *
 * A menu row carries no key equivalent, so this property is what makes the row
 * do anything at all. The cases are the ways it can lie: installed but not
 * callable, callable but running the wrong id, and answering `true` for a command
 * nothing registered (which would make a dead menu row look alive).
 *
 * Runs against a real DOM (happy-dom) because the transport IS a `window`
 * property; the registry is global on `globalThis`, as it is in the app.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { RUN_COMMAND_PROPERTY, dispatchRunCommand, installCommandRunner } from '@/client/lib/native/run-command';
import { registerCommand } from '@/client/lib/commands/registry';

const displaced: Record<string, unknown> = {};
let dom: Window;

beforeAll(() => {
  for (const key of ['window', 'document'] as const) displaced[key] = (globalThis as Record<string, unknown>)[key];
  dom = new Window({ url: 'http://127.0.0.1:3000/' });
  (globalThis as Record<string, unknown>).window = dom;
  (globalThis as Record<string, unknown>).document = dom.document;
});

afterAll(() => {
  for (const [key, value] of Object.entries(displaced)) {
    if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
    else (globalThis as Record<string, unknown>)[key] = value;
  }
});

function transport(): ((id: unknown, args?: unknown) => boolean) | undefined {
  const callable = (window as unknown as Record<string, unknown>)[RUN_COMMAND_PROPERTY];
  return typeof callable === 'function' ? (callable as (id: unknown, args?: unknown) => boolean) : undefined;
}

let dispose: (() => void) | null = null;

beforeEach(() => {
  dispose?.();
  dispose = null;
});

describe('__kabmoRunCommand', () => {
  test('the installer publishes a callable property', () => {
    installCommandRunner();
    expect(transport()).toBeFunction();
  });

  test('a registered command runs with the shell\'s arguments', () => {
    installCommandRunner();
    const calls: unknown[] = [];
    dispose = registerCommand('test.native-command', (args) => { calls.push(args); });

    expect(transport()?.('test.native-command', { pick: 'worktree' })).toBe(true);
    expect(calls).toEqual([{ pick: 'worktree' }]);
  });

  test('an unregistered id answers false instead of throwing', () => {
    installCommandRunner();
    expect(transport()?.('workspace.not-a-command')).toBe(false);
  });

  test('a missing or blank id is refused', () => {
    installCommandRunner();
    expect(transport()?.(undefined)).toBe(false);
    expect(transport()?.(42)).toBe(false);
    expect(transport()?.('   ')).toBe(false);
  });

  test('the exported dispatcher is the same contract', () => {
    let runs = 0;
    dispose = registerCommand('test.direct', () => { runs += 1; });
    expect(dispatchRunCommand('test.direct')).toBe(true);
    expect(runs).toBe(1);
  });

  test('a re-install replaces the property rather than stacking', () => {
    installCommandRunner();
    const first = transport();
    installCommandRunner();
    expect(transport()).toBeFunction();
    // Both installs point at the same function, so a second one cannot double-run.
    expect(transport()).toBe(first);
  });
});
