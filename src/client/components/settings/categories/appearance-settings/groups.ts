/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Settings → Appearance sidebar: four groups over the twelve appearance
 * sections.
 *
 * The category used to be one scrolling column of a hundred-odd cards — 42 app
 * palettes, 65 editor themes and ten layout choices — so a reader who came to
 * move the sidebar scrolled past every theme in the product to reach it. The
 * grouping is a NAVIGATION fact, so it lives here as data: the sidebar renders
 * this list, and the detail pane renders the sections each group names.
 * `APPEARANCE_SECTION_IDS` is the union's source, so a section added to the
 * category must be assigned to a group (the `Record<AppearanceSectionId, …>` in
 * `AppearanceSettings` refuses to compile otherwise) and cannot be silently
 * dropped from the product.
 *
 * The ORDER is the flow a new install takes: the palette first because
 * `appearance` is the category the modal opens on and a theme is the answer to
 * "why does this look wrong", then the shell around it, then the editor itself.
 */

import type { LucideIcon } from 'lucide-preact';
import { Code2, Palette, PanelLeft, Settings2 } from 'lucide-preact';

/** Every section a group can own. */
export const APPEARANCE_SECTION_IDS = [
  'theme',
  'sidebar',
  'panel-nav',
  'surface',
  'border',
  'icons',
  'tray',
  'editor-font',
  'editor-theme',
  'editor-indent',
  'editor-typing',
  'editor-blame',
] as const;

export type AppearanceSectionId = (typeof APPEARANCE_SECTION_IDS)[number];

export type AppearanceGroupId = 'palette' | 'shell' | 'editor' | 'editor-behaviour';

export interface AppearanceGroup {
  id: AppearanceGroupId;
  label: string;
  /** One line under the label in the sidebar. */
  hint: string;
  /** Stated above the group's sections in the detail pane. */
  description: string;
  icon: LucideIcon;
  sections: readonly AppearanceSectionId[];
}

export const APPEARANCE_GROUPS: readonly AppearanceGroup[] = [
  {
    id: 'palette',
    label: 'Palette',
    hint: 'The console’s colours',
    description: 'The palette every surface, row and dialog is painted from.',
    icon: Palette,
    sections: ['theme'],
  },
  {
    id: 'shell',
    label: 'Shell',
    hint: 'Sidebar, panels, material, rules, icons',
    description:
      'The shape of the console around the conversation: the session sidebar, how each desktop panel column is navigated, what the windows are made of, whether the hairlines are drawn, and how glyphs and marks are painted.',
    icon: PanelLeft,
    sections: ['sidebar', 'panel-nav', 'surface', 'border', 'icons', 'tray'],
  },
  {
    id: 'editor',
    label: 'Editor',
    hint: 'Typeface and colour theme',
    description:
      'The code editor’s own two axes, independent of the console palette: the face it is set in, and the TextMate theme it paints with.',
    icon: Code2,
    sections: ['editor-font', 'editor-theme'],
  },
  {
    id: 'editor-behaviour',
    label: 'Editor behaviour',
    hint: 'Indentation, typing, line blame',
    description:
      'What the editor does as you type, rather than how it looks. Each one reaches an editor that is already open without a reload.',
    icon: Settings2,
    sections: ['editor-indent', 'editor-typing', 'editor-blame'],
  },
];
