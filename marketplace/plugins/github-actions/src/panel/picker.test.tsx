/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The panel's header control: the SHARED repository picker.
 *
 * It has its own suite because it asserts something the other panel tests do not
 * — that a pick is written to the slot Files/Search/Source Control/Terminal read,
 * rather than kept privately — and because the two facts it pins are the ones
 * that break silently: a copy of the picker looks identical until another panel
 * fails to follow it, and a stale list under a moved picker looks like a read.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { clickAndSettle, harness, installDom, mount, resetHarness, restoreDom, row, teardownHarness } from './test-harness';

beforeAll(installDom);
afterAll(restoreDom);
beforeEach(resetHarness);
afterEach(teardownHarness);

/** The trigger the host draws for the shared pick, found by its own title. */
function trigger(): Element | null {
  return document.querySelector('[title="Switch git project"]');
}

/** Open the picker and choose the row whose label is `label`. */
async function pick(label: string): Promise<void> {
  await clickAndSettle(trigger());
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (entry) => (entry.textContent ?? '').trim() === label,
  );
  await clickAndSettle(option);
}

describe('the shared repository picker', () => {
  test('the header draws it, and a pick moves that slot', async () => {
    await mount();
    expect(trigger(), 'the panel must draw the shared picker, not only read the scope').not.toBeNull();
    expect(trigger()?.textContent).toContain('alpha');

    await pick('ws');

    // The row is written to the SAME slot Files/Search/Git/Terminal read, which
    // is the only thing that makes the control shared rather than a copy.
    expect(harness.picks).toEqual(['.']);
    expect(trigger()?.textContent).toContain('ws');
  });

  test('a pick that cannot be read drops the previous scope’s rows', async () => {
    await mount();
    expect(row(2)).not.toBeNull();

    // The wiki repo is not addressable through the REST API: GitHub answers 404.
    harness.listOutcome = {
      ok: false,
      error: { code: 'handler_error', message: 'Not found (404). The repository may be private.' },
    };
    await pick('ws');

    expect(harness.picks.at(-1)).toBe('.');
    expect(row(2), 'the old repo’s rows must not survive the pick').toBeNull();
    expect(harness.container?.textContent).toContain('404');
  });
});
