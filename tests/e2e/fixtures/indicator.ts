/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Geometry contract for the docked generating indicator, shared by the desktop
 * and phone specs so the two layouts cannot be held to different rules.
 *
 * The reported bug: a long activity phrase (a `bash` command, a grep pattern,
 * a path) pushed the provider, the model and the loading dots out of the row,
 * so the only sign of life disappeared exactly when a run was busy. The phrase
 * was a non-shrinking span, so it took its full width and the trailing dots
 * were clipped by the wrapper's `truncate`.
 *
 * Measured on the broken build, 1024px desktop, a 72-character phrase:
 * `provider 0px, model 0px, dots ending 82px PAST the row's right edge`.
 *
 * What is asserted is the reader's own view, measured in the real browser —
 * happy-dom computes no layout, so a unit test on the class list cannot see
 * any of it:
 *
 *   - the verb is genuinely TRUNCATED, or the fixture was too short and the
 *     rest of the assertions would be vacuous;
 *   - the dots keep a non-zero box and end inside the row;
 *   - provider and model keep a non-zero box and start inside the row.
 *
 * The elements are found STRUCTURALLY (the dots are the `.dot-anim-1` marks,
 * the verb is the span beside them, identity is what precedes it), so the
 * contract is about the rendered row rather than about marker attributes.
 */

import { expect, type Page } from '@playwright/test';

interface Box {
  text: string;
  left: number;
  right: number;
  width: number;
}

export interface IndicatorGeometry {
  row: { left: number; right: number; width: number };
  verb: { text: string; clientWidth: number; scrollWidth: number } | null;
  dots: Box | null;
  identity: Box[];
}

/** Measure the indicator's row and every part that must stay visible. */
export async function measureIndicator(page: Page): Promise<IndicatorGeometry | null> {
  return page.evaluate(() => {
    const row = document.querySelector('#generating-docked-indicator');
    if (!row) return null;
    const rowRect = row.getBoundingClientRect();
    const box = (element: Element | null): Box | null => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        text: (element.textContent ?? '').trim(),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      };
    };

    // The dots are three `.dot-anim-*` marks inside one span; the span beside
    // them is the activity phrase.
    const dotMark = row.querySelector('.dot-anim-1');
    const dots = dotMark?.parentElement ?? null;
    const verbWrap = dots?.parentElement ?? null;
    const verb = verbWrap?.firstElementChild as HTMLElement | null;

    // Everything before the verb wrapper that carries text is identity. The
    // `•` separator carries text but names nothing, so it is skipped.
    const identity: Box[] = [];
    for (let node = verbWrap?.previousElementSibling; node; node = node.previousElementSibling) {
      const measured = box(node);
      if (!measured || !measured.text || measured.text === '•') continue;
      identity.push(measured);
    }

    return {
      row: { left: Math.round(rowRect.left), right: Math.round(rowRect.right), width: Math.round(rowRect.width) },
      verb: verb
        ? { text: (verb.textContent ?? '').trim(), clientWidth: verb.clientWidth, scrollWidth: verb.scrollWidth }
        : null,
      dots: box(dots),
      identity,
    };
  });
}

/**
 * Wait for the indicator to name the long running tool, then assert the row
 * kept its identity and its dots.
 *
 * The measurement has to happen WHILE the phrase is live, and in one pass: the
 * tool's activity phrase lasts only as long as the call does (the next frame
 * replaces it — `Thinking` for the following tool result, `Writing response`
 * for the answer), so a `toContainText` followed by a separate `toHaveAttribute`
 * polls two different instants and loses the window. Verified: the second
 * assertion read `Thinking` while the first had already seen `Running`.
 *
 * The spawn path also republishes the session topic, whose snapshot calls
 * `onResumeStream`. That write must not overwrite a phrase a frame already
 * published — but the ordering is a RACE (the republish and the child's first
 * tool frame race each other), so a browser spec cannot pin it: measured with
 * the guard reverted, this fixture still showed `Running` for the whole call.
 * The invariant lives in `omp-callbacks.test.ts`, where the ordering is
 * explicit, and the write is guarded at its source.
 *
 * The tolerance is 1px: sub-pixel rounding on a device-pixel-ratio viewport
 * must not decide whether a run is reported as broken.
 */
export async function expectIndicatorSurvivesLongPhrase(page: Page, expectedCommand: string): Promise<IndicatorGeometry> {
  const deadline = Date.now() + 30_000;
  let measured: IndicatorGeometry | null = null;
  while (Date.now() < deadline) {
    const candidate = await measureIndicator(page);
    if (candidate?.verb?.text.startsWith('Running') && candidate.verb.text.includes(expectedCommand.slice(0, 24))) {
      measured = candidate;
      break;
    }
    await page.waitForTimeout(50);
  }
  expect(
    measured,
    `the indicator never reported the running phrase for "${expectedCommand}"`,
  ).not.toBeNull();
  const geometry = measured!;

  // The reported symptom FIRST: nothing may be drawn outside the row. On the
  // broken build this is what failed — the phrase pushed the dots 82px past the
  // row's right edge and the identity spans to zero width.
  expect(geometry.dots, 'the loading dots were dropped from the row').not.toBeNull();
  expect(geometry.dots!.width, 'the loading dots collapsed to nothing').toBeGreaterThan(0);
  expect(geometry.dots!.right, 'the loading dots are drawn past the row').toBeLessThanOrEqual(geometry.row.right + 1);
  expect(geometry.dots!.left, 'the loading dots are drawn before the row').toBeGreaterThanOrEqual(geometry.row.left - 1);

  // Identity: whichever halves the run reported must be readable, not squeezed
  // to nothing. A run whose identity never arrived has none, and the indicator
  // says `Loading…` instead — that state is not this contract.
  expect(geometry.identity.length, 'the indicator named no provider or model').toBeGreaterThan(0);
  for (const half of geometry.identity) {
    expect(half.width, `"${half.text}" collapsed to nothing beside a long phrase`).toBeGreaterThan(0);
    expect(half.left, `"${half.text}" was pushed out of the row`).toBeGreaterThanOrEqual(geometry.row.left - 1);
    expect(half.right, `"${half.text}" overflows the row`).toBeLessThanOrEqual(geometry.row.right + 1);
  }

  // ...and the mechanism that keeps them there: the phrase is a truncating box
  // whose content is wider than the box, i.e. it ended in an ellipsis rather
  // than being allowed to run over everything beside it.
  expect(
    geometry.verb!.clientWidth,
    'the activity phrase is not a truncating box (clientWidth 0)',
  ).toBeGreaterThan(0);
  expect(
    geometry.verb!.scrollWidth,
    `the fixture's phrase did not overflow (scrollWidth ${geometry.verb!.scrollWidth} / clientWidth ${geometry.verb!.clientWidth})`,
  ).toBeGreaterThan(geometry.verb!.clientWidth);

  return geometry;
}
