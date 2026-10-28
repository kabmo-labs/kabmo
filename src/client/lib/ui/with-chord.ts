/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A tooltip's text with the chord that actually invokes it.
 *
 * Derived from the workspace keymap rather than typed out, because a
 * hand-written "⌘B" beside a binding that listens for something else is exactly
 * the drift the keymap table exists to prevent. Lives here rather than in one
 * navbar because both headers label the same toggles.
 */

import { WORKSPACE_KEY_BINDINGS, type WorkspaceCommand } from '@/shared/lib/workspace/keymap';
import { describeBinding } from '@/shared/lib/ui/key-binding';

export function withChord(command: WorkspaceCommand, label: string): string {
  const binding = WORKSPACE_KEY_BINDINGS.find((entry) => entry.command === command);
  return binding ? `${label} (${describeBinding(binding)})` : label;
}
