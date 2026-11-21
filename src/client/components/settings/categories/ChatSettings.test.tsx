/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Chats is two panes, and a phone is two screens.
 *
 * Three facts are pinned here, each one a way the category can look right on a
 * desktop and be unusable on a phone:
 *
 * - the sidebar lists every group and opens on the first one, so the category
 *   never lands on an empty detail;
 * - choosing a group swaps the detail pane and writes NO setting — a row is
 *   navigation, not an edit;
 * - on a phone the list yields to the chosen group, and the back bar returns to
 *   it. The panes are hidden by class (`hidden md:flex`), so the classes are
 *   what is asserted; if `ChatSettings` ever selects a group without calling
 *   `openDetail`, the phone stays on the list and this fails.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ChatSettings } from '@/client/components/settings/categories/ChatSettings';
import { DEFAULT_SETTINGS } from '@/shared/lib/settings/defaults';
import {
  SettingsDrillProvider,
  type SettingsDrill,
} from '@/client/components/settings/drill';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;
let updates = 0;
/** What the category published to the sheet's ONE band. */
let drill: SettingsDrill | null = null;

function mount(): void {
  act(() => {
    render(
      h(
        SettingsDrillProvider,
        {
          register: (next: SettingsDrill | null) => {
            drill = next;
          },
          children: h(ChatSettings, {
            settings: DEFAULT_SETTINGS,
            onUpdate: () => {
              updates += 1;
            },
          }),
        },
      ),
      container,
    );
  });
}

/** The sidebar row whose label is exactly `label`. */
function groupRow(label: string): HTMLButtonElement {
  const row = [...container.querySelectorAll('button')].find(
    (button) => button.querySelector('span.font-semibold')?.textContent === label,
  );
  if (!row) throw new Error(`no group row labelled ${label}`);
  return row as HTMLButtonElement;
}

/** The section headings the detail pane currently draws, in order. */
function headings(): string[] {
  return [...container.querySelectorAll('h4')].map((heading) => heading.textContent ?? '');
}

/** The master/detail shell's two pane wrappers. */
function panes(): { list: HTMLElement; detail: HTMLElement } {
  const root = container.firstElementChild as HTMLElement;
  return { list: root.children[0] as HTMLElement, detail: root.children[1] as HTMLElement };
}

beforeEach(() => {
  installDomGlobals(new Window());
  container = document.createElement('div');
  document.body.appendChild(container);
  updates = 0;
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
});

describe('ChatSettings master/detail', () => {
  test('lists every group and opens on the first one', () => {
    mount();

    for (const label of ['Layout', 'Transcript', 'Sessions']) {
      expect(groupRow(label)).toBeTruthy();
    }

    expect(groupRow('Layout').getAttribute('aria-current')).toBe('true');
    expect(headings()).toEqual(['Chat Width', 'Composer']);
  });

  test('choosing a group swaps the detail and writes no setting', () => {
    mount();

    act(() => groupRow('Transcript').click());

    expect(headings()).toEqual(['Tool Calls', 'Changed Files', 'Follow-up Dispatch']);
    expect(groupRow('Transcript').getAttribute('aria-current')).toBe('true');
    expect(updates).toBe(0);
  });

  /**
   * The phone's drill, through the SHEET's one band. The pane draws no bar of
   * its own (three stacked bars were measured at 163px of a 844px screen), so
   * the registration is what a test can pin: the label, the back control's name,
   * and that calling it returns to the list.
   */
  test('on a phone the chosen group replaces the list and registers with the sheet band', () => {
    mount();
    const { list, detail } = panes();

    expect(list.className).not.toContain('hidden');
    expect(detail.className).toContain('hidden');
    expect(drill).toBeNull();

    act(() => groupRow('Sessions').click());

    expect(list.className).toContain('hidden');
    expect(detail.className).not.toContain('hidden');
    expect(drill?.label).toBe('Sessions');
    expect(drill?.backLabel).toBe('Back to Chat settings');
    expect(container.querySelector('button[aria-label="Back to Chat settings"]')).toBeNull();

    act(() => drill?.back());

    expect(list.className).not.toContain('hidden');
    expect(detail.className).toContain('hidden');
    expect(drill).toBeNull();
  });
});
