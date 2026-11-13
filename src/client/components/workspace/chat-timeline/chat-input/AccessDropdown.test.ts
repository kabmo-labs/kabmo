/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The access chip's copy follows the HARNESS, because the same three tiers mean
 * different things on the two transports: omp's tier IS the approval gate,
 * while an ACP agent decides which calls it asks about and Kabmo's tier only
 * answers those requests. The omp copy also promises `tools.restrictedFolders`
 * behaviour, which does not exist on another agent.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { AccessDropdown } from '@/client/components/workspace/chat-timeline/chat-input/AccessDropdown';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement | undefined;

beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
  restoreDomGlobals();
});

afterAll(() => restoreDomGlobals());

async function open(harness?: string): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(AccessDropdown, { value: 'always-ask', onSelect: () => {}, ...(harness ? { harness } : {}) }), container!);
  });
  const trigger = container.querySelector('button') as HTMLButtonElement;
  await act(async () => { trigger.click(); });
  return container;
}

describe('AccessDropdown copy', () => {
  test('omp keeps the restricted-folder promise', async () => {
    const el = await open('omp-rpc');
    const yolo = el.querySelector('[title*="restricted folder"]');
    expect(yolo).not.toBeNull();
    // omp's tier is the gate, so there is nothing to disclaim.
    expect(el.textContent).not.toContain('decides which calls it asks about');
  });

  test('another agent gets the answer-policy wording and the disclaimer', async () => {
    const el = await open('claude');
    expect(el.textContent).toContain('decides which calls it asks about');
    // The omp-only rule must not be promised on a transport that has no such gate.
    expect(el.querySelector('[title*="restricted folder"]')).toBeNull();
    expect(el.querySelector('[title*="Every approval the agent asks for"]')).not.toBeNull();
  });
});
