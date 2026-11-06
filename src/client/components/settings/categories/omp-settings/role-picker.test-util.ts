/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Driving a role row's SEARCHABLE picker from a test.
 *
 * The picker's listbox is portalled to `document.body` (`AnchoredMenu`), so it is
 * not a descendant of the mounted container and `container.querySelector` cannot
 * see it. These helpers keep that fact in ONE place: every test that exercises a
 * role picker goes through them, and the day the portal changes, one file moves.
 */

import { act } from 'preact/test-utils';

/** One role's picker trigger. */
export function rolePicker(el: HTMLElement, role: string): HTMLButtonElement {
  const node = el.querySelector(`button[role="combobox"][aria-label*="(${role})"]`);
  if (!node) throw new Error(`no picker for role ${role}`);
  return node as HTMLButtonElement;
}

/** The rows the OPEN picker is showing, from the portal in `document.body`. */
export function openRows(): HTMLButtonElement[] {
  return [...document.querySelectorAll('[role="option"]')] as HTMLButtonElement[];
}

export async function openPicker(el: HTMLElement, role: string): Promise<void> {
  await act(async () => {
    rolePicker(el, role).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
}

/** Open a role's picker and commit the row whose label it is. */
export async function pickRole(el: HTMLElement, role: string, label: string): Promise<void> {
  await openPicker(el, role);
  const row = openRows().find((node) => node.textContent?.includes(label));
  if (!row) throw new Error(`no option "${label}" for role ${role}`);
  await act(async () => {
    row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
}
