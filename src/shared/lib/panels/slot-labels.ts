/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a plugin CONTRIBUTES, named the way a reader understands it.
 *
 * Two vocabularies meet here and they are not the same list. The POSITIONAL
 * slots are places (`rightPanel`, `panel`, `headerPanel`, `settingsSection`) and
 * a plugin fills at most one of each. The LIST slots are rows added to a surface
 * that already exists (`messageAction`, `composerAction`, `fileOpener`, …) and a
 * plugin may contribute several to one.
 *
 * A card has to say which, because "this plugin adds a panel on the right" and
 * "this plugin adds a button to every chat row" are different promises — and a
 * badge reading `rightPanel` makes the reader learn the SDK's vocabulary to
 * answer a question the pane should answer in words.
 *
 * The labels live in ONE table shared by the installed card and the store card,
 * so the same contribution cannot be called two things depending on whether the
 * plugin is installed.
 */

import type { ListSlotName } from '@kabmo-labs/kabmo-sdk';
import type { PanelSlotName } from '@/shared/types';

export interface SlotLabel {
  /** The word a badge shows. Short, because a card has one line. */
  label: string;
  /** What it actually adds, for the badge's `title`. */
  detail: string;
  /** `panel` draws a place; `row` adds to a surface that already exists. */
  kind: 'panel' | 'row';
}

/** The positional slots, in the order a card lists them. */
export const POSITIONAL_SLOT_LABELS: Record<PanelSlotName, SlotLabel> = {
  rightPanel: {
    label: 'Panel view',
    detail: 'A view with its own button — it rides the left dock or the right column.',
    kind: 'panel',
  },
  panel: {
    label: 'Editor takeover',
    detail: 'A full-height view that owns the editor column.',
    kind: 'panel',
  },
  headerPanel: {
    label: 'Header button',
    detail: 'A control in the top navbar — a readout, a dropdown, or a button that opens a panel.',
    kind: 'panel',
  },
  settingsSection: {
    label: 'Settings section',
    detail: 'A block inside this plugin’s own settings pane.',
    kind: 'panel',
  },
};

/** The list slots, keyed by their registration name. */
export const LIST_SLOT_LABELS: Record<ListSlotName, SlotLabel> = {
  messageAction: {
    label: 'Message actions',
    detail: 'Buttons on every chat message row.',
    kind: 'row',
  },
  commandPaletteAction: {
    label: 'Command palette',
    detail: 'Commands added to the palette.',
    kind: 'row',
  },
  fileOpener: {
    label: 'File openers',
    detail: 'Handlers that open a file in its own viewer instead of the editor.',
    kind: 'row',
  },
  sourceCodeRenderer: {
    label: 'Source renderers',
    detail: 'Alternate renderers for a source file.',
    kind: 'row',
  },
  diffRenderer: {
    label: 'Diff renderers',
    detail: 'Alternate renderers for a diff.',
    kind: 'row',
  },
  timelineRenderer: {
    label: 'Timeline renderers',
    detail: 'Alternate renderers for the chat timeline.',
    kind: 'row',
  },
  composerAction: {
    label: 'Composer buttons',
    detail: 'Buttons in the composer’s toolbar.',
    kind: 'row',
  },
  composerBanner: {
    label: 'Composer banners',
    detail: 'A strip drawn above the composer’s input.',
    kind: 'row',
  },
  providerIcon: {
    label: 'Provider icons',
    detail: 'Marks for a model provider.',
    kind: 'row',
  },
  pendingInteraction: {
    label: 'Pending interactions',
    detail: 'A dialog the agent can block on.',
    kind: 'row',
  },
  messageDirective: {
    label: 'Message directives',
    detail: 'A fenced-block name this plugin renders.',
    kind: 'row',
  },
  contentScript: {
    label: 'Content scripts',
    detail: 'Code that runs while the plugin is enabled and draws nothing.',
    kind: 'row',
  },
};

/** The label for a positional slot. */
export function positionalSlotLabel(slot: PanelSlotName): SlotLabel {
  return POSITIONAL_SLOT_LABELS[slot];
}

/** The label for a list slot. */
export function listSlotLabel(slot: ListSlotName): SlotLabel {
  return LIST_SLOT_LABELS[slot];
}
