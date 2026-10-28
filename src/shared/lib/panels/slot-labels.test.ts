/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The slot vocabulary a card speaks.
 *
 * Two tables and one rule each, and the rule is the one that goes wrong
 * silently: a slot the SDK knows but this file does not would render a badge
 * reading `undefined` — or, with the tables typed as `Record`, fail to compile
 * and be fixed by adding an entry. That is the point of typing them, so the test
 * re-derives both lists from the SDK and asserts every name has a label.
 *
 * The second rule is that a label is a WORD, not the SDK's identifier: a card
 * saying `rightPanel` makes the reader learn the SDK to answer a question the
 * pane should answer in words.
 */

import { describe, expect, test } from 'bun:test';
import { LIST_SLOT_NAMES } from '@kabmo-labs/kabmo-sdk';
import { PANEL_SLOT_NAMES } from '@/shared/types';
import { LIST_SLOT_LABELS, POSITIONAL_SLOT_LABELS } from '@/shared/lib/panels/slot-labels';

describe('positional slot labels', () => {
  test('every positional slot the manifest may declare has a label', () => {
    for (const slot of PANEL_SLOT_NAMES) {
      const label = POSITIONAL_SLOT_LABELS[slot];
      expect(label).toBeDefined();
      expect(label.label.length).toBeGreaterThan(0);
      expect(label.detail.length).toBeGreaterThan(0);
      expect(label.kind).toBe('panel');
    }
  });

  test('a label is words, never the registration name', () => {
    for (const slot of PANEL_SLOT_NAMES) {
      expect(POSITIONAL_SLOT_LABELS[slot].label).not.toBe(slot);
      expect(POSITIONAL_SLOT_LABELS[slot].label).toContain(' ');
    }
  });
});

describe('list slot labels', () => {
  test('every list slot the SDK offers has a label', () => {
    for (const slot of LIST_SLOT_NAMES) {
      const label = LIST_SLOT_LABELS[slot];
      expect(label).toBeDefined();
      expect(label.label.length).toBeGreaterThan(0);
      expect(label.detail.length).toBeGreaterThan(0);
      expect(label.kind).toBe('row');
    }
  });

  test('the table has no row the SDK does not register', () => {
    // A leftover key is a label for a slot nothing can fill — dead weight that
    // reads as support for a feature that does not exist.
    const known = new Set<string>(LIST_SLOT_NAMES);
    for (const key of Object.keys(LIST_SLOT_LABELS)) expect(known.has(key)).toBe(true);
  });
});
