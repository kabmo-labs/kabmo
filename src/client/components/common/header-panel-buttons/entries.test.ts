/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where a plugin's navbar entry goes, and why the answer is not "the row".
 *
 * A phone header shares 320–430px between the wordmark, the session title and
 * the controls used mid-conversation. A plugin readout is the first thing that
 * has to give way, and the measured cost of not folding it is the session title:
 * with a `CPU 18% / RAM 2.5G` readout (73px) in the row at 390px, the title kept
 * 48px of its 74px and was clipped; at 430px it kept all of it.
 *
 * Three rules, and each is a control that becomes unreachable when broken:
 *
 * - **An ACTION entry folds into `⋯`.** It has one click and no UI of its own,
 *   so a menu row is the same action in words.
 * - **A dropdown or a static readout never folds.** A dropdown needs its
 *   trigger's anchor, and a static readout has no action to perform; folding
 *   either would be a different control rather than the same one moved.
 * - **A wide enough phone, and every desktop, draws everything in the row.**
 *   The threshold is a WIDTH, not a device class — the same rule the header's
 *   own reload/sign-out fold follows.
 *
 * The hook half is exercised through `HeaderControls` (which is where the row
 * and the menu actually split); this file pins the pure decision it encodes.
 */

import { describe, expect, test } from 'bun:test';
import { MOBILE_HEADER_ACTION_PX, MOBILE_HEADER_ENTRY_MAX_PX } from '@/client/components/common/header-panel-buttons/entries';

describe('the header entry thresholds', () => {
  test('the action threshold is past the width where the title clips', () => {
    // Measured: 390px clips the title to 48px of 74px; 430px does not.
    expect(MOBILE_HEADER_ACTION_PX).toBe(430);
    expect(MOBILE_HEADER_ACTION_PX).toBeGreaterThan(390);
  });

  test('the per-entry cap holds a two-column readout and no more', () => {
    // The measured readout is 73px wide at 12px mono; the cap leaves room for a
    // longer figure without letting one plugin take the row.
    expect(MOBILE_HEADER_ENTRY_MAX_PX).toBeGreaterThanOrEqual(73);
    expect(MOBILE_HEADER_ENTRY_MAX_PX).toBeLessThan(120);
  });
});
