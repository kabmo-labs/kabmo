/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The assembled panel, mounted in a real DOM with the kit's own services faked.
 *
 * A component test rather than a formatter test, because what goes wrong here is
 * the JOINTS: which repository the read names, whether a failed read is drawn as
 * an empty list, whether clicking a row asks the server for that run, and whether
 * a log refusal is a sentence rather than an empty pane. Each of those is
 * invisible to a unit test of `format.ts`.
 *
 * The shared repository picker has its own suite (`picker.test.tsx`).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { page } from './test-fixtures';
import { clickAndSettle, harness, installDom, mount, resetHarness, restoreDom, row, teardownHarness } from './test-harness';

beforeAll(installDom);
afterAll(restoreDom);
beforeEach(resetHarness);
afterEach(teardownHarness);

describe('ActionsPanel', () => {
  test('reads the shared scope and draws one row per run', async () => {
    await mount();
    expect(harness.calls[0]).toEqual({
      method: 'list',
      input: { root: '/ws', repo: 'projects/alpha', filter: { branch: '', status: '' } },
    });
    expect(row(2)).not.toBeNull();
    expect(row(1)).not.toBeNull();
    const text = harness.container?.textContent ?? '';
    expect(text).toContain('Release');
    expect(text).toContain('#185');
    expect(text).toContain('main');
  });

  test('a failed read is a sentence, not an empty list', async () => {
    harness.listOutcome = { ok: false, error: { code: 'handler_error', message: 'This checkout has no `origin` remote.' } };
    await mount();
    expect(harness.container?.textContent).toContain('no `origin` remote');
    expect(row(2)).toBeNull();
  });

  test('opening a run asks for that run and shows its progress', async () => {
    await mount();
    await clickAndSettle(row(2));
    const runCall = harness.calls.find((call) => call.method === 'run');
    expect(runCall).toBeDefined();
    const input = runCall?.input;
    const askedId = input && typeof input === 'object' && 'id' in input ? input.id : null;
    expect(askedId).toBe(2);
    const text = harness.container?.textContent ?? '';
    expect(text).toContain('2/2 jobs');
    expect(text).toContain('1 failing');
    expect(text).toContain('Gates / Checks');
  });

  test('a log refusal names the token instead of drawing an empty pane', async () => {
    await mount();
    await clickAndSettle(row(2));
    await clickAndSettle(harness.container?.querySelector('[data-job-log="11"]'));
    expect(harness.calls.some((call) => call.method === 'log')).toBe(true);
    expect(harness.container?.textContent).toContain('Job logs need a token');
  });

  test('a run with no matching filter says what would find one', async () => {
    harness.listOutcome = { ok: true, value: page({ runs: [], total: 0 }) };
    await mount();
    expect(harness.container?.textContent).toContain('Clear the branch or state');
  });

  test('the verbs are absent without a token, and the reason is stated', async () => {
    harness.listOutcome = { ok: true, value: page({ authenticated: false }) };
    await mount();
    await clickAndSettle(row(2));
    const buttons = [...(harness.container?.querySelectorAll('button') ?? [])].map((button) => button.textContent ?? '');
    expect(buttons.some((label) => label.includes('Cancel'))).toBe(false);
    expect(harness.container?.textContent).toContain('need a token');
  });
});
