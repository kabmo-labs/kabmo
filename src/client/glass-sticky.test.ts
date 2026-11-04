/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sticky folder header's material, split from `glass.test.ts` by subject:
 * it is the one element in `glass.css` that matches BOTH a tier rule (the
 * `bg-canvas` well) and a state rule (`.glass-sticky[data-stuck]`).
 *
 * The phone drawer's header paints `bg-canvas` because its rows sit on canvas
 * (see `modern/WorkspaceHeader.tsx`), so the well rule matched it. That
 * selector is (0,4,0) and the stuck fill is (0,3,0), so the well won: measured
 * at 412x900 with the drawer open and 420px scrolled, a PINNED header computed
 * to `rgba(0,0,0,0)` — sticky active, background transparent — while the
 * desktop column's `bg-paper` header painted its fill. A sticky header is a
 * sticky header, never a well.
 */

import { describe, expect, test } from 'bun:test';

const read = (file: string): Promise<string> => Bun.file(new URL(file, import.meta.url)).text();

describe('glass sticky header material', () => {
  test('the canvas well rule steps aside for a sticky header', async () => {
    const glass = await read('./glass.css');
    const well = glass.slice(glass.indexOf('[data-surface="glass"] .app-window .bg-canvas'));
    expect(well.slice(0, well.indexOf('{'))).toContain(':not(.glass-sticky)');
  });

  test('the fill belongs to the stuck state and outlives the well rule', async () => {
    const glass = await read('./glass.css');
    // At rest: nothing, so a folder header is not a stripe across the list.
    const rest = glass.slice(glass.indexOf('[data-surface="glass"] .glass-sticky {'));
    expect(rest.slice(0, rest.indexOf('}'))).toContain('background-color: transparent;');

    // While pinned: the opaque composite, painted AFTER the rest rule so source
    // order agrees with the state it describes.
    const restAt = glass.indexOf('[data-surface="glass"] .glass-sticky {');
    const stuckAt = glass.indexOf('[data-surface="glass"] .glass-sticky[data-stuck] {');
    expect(stuckAt).toBeGreaterThan(restAt);
    const stuck = glass.slice(stuckAt);
    expect(stuck.slice(0, stuck.indexOf('}'))).toContain('background-color: var(--glass-stuck);');
  });
});

