/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Settings → Chats sidebar: four groups over the seven chat sections.
 *
 * The category used to be one scrolling column, which made a reader scroll past
 * composer frames to reach a keyboard chord. Grouping is a NAVIGATION fact, so
 * it lives here as data: the sidebar renders this list, and the detail pane
 * renders the sections each group names. `CHAT_SECTION_IDS` is the union's
 * source, so a section added to the category must be assigned to a group (the
 * `Record<ChatSectionId, …>` in `ChatSettings` refuses to compile otherwise)
 * and the sidebar cannot silently drop one.
 */

import type { LucideIcon } from 'lucide-preact';
import { Keyboard, ListOrdered, MessageSquare, PanelLeft } from 'lucide-preact';

/** Every section a group can own. */
export const CHAT_SECTION_IDS = [
  'width',
  'composer',
  'tool-calls',
  'follow-up',
  'titles',
  'goal',
  'keybindings',
] as const;

export type ChatSectionId = (typeof CHAT_SECTION_IDS)[number];

export type ChatSettingGroupId = 'layout' | 'transcript' | 'sessions' | 'keys';

export interface ChatSettingGroup {
  id: ChatSettingGroupId;
  label: string;
  /** One line under the label in the sidebar. */
  hint: string;
  /** Stated above the group's sections in the detail pane. */
  description: string;
  icon: LucideIcon;
  sections: readonly ChatSectionId[];
}

export const CHAT_SETTING_GROUPS: readonly ChatSettingGroup[] = [
  {
    id: 'layout',
    label: 'Layout',
    hint: 'Chat width and composer shape',
    description: 'How wide the conversation is drawn, and the shape of the box you type into.',
    icon: PanelLeft,
    sections: ['width', 'composer'],
  },
  {
    id: 'transcript',
    label: 'Transcript',
    hint: 'Tool calls and follow-up dispatch',
    description:
      'How a tool call is drawn, and what happens to a prompt sent while the agent is still running.',
    icon: ListOrdered,
    sections: ['tool-calls', 'follow-up'],
  },
  {
    id: 'sessions',
    label: 'Sessions',
    hint: 'Titles and goal mode',
    description: 'How a session gets its name, and the defaults a new goal starts with.',
    icon: MessageSquare,
    sections: ['titles', 'goal'],
  },
  {
    id: 'keys',
    label: 'Keyboard',
    hint: 'Send, newline and steering keys',
    description: 'Which chord sends a prompt, inserts a newline, or steers the running turn.',
    icon: Keyboard,
    sections: ['keybindings'],
  },
];
