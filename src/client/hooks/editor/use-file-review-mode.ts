/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Review mode for one open document, as a per-tab persisted toggle.
 *
 * ONE key (`editor.reviewMode`) and one owner, shared by the desktop pane and the
 * phone's full-screen editor: both draw the same surface, both remember the
 * choice per tab, and a second copy of this rule is how the two layouts end up
 * disagreeing about whether a document is being reviewed.
 *
 * Off by default, and that default is the feature: review mode swallows clicks
 * inside the document — links, copy buttons, the diagram viewer all become block
 * selections. A reader who never asked to review anything keeps every one of
 * them, which is why the mode is entered from a toolbar button and nowhere else.
 */

import { useSessionState } from '@/client/hooks/workspace/session-state';

export interface FileReviewMode {
  /** This tab is being reviewed. */
  active: boolean;
  /** Turn it on or off. */
  toggle: () => void;
}

export function useFileReviewMode(tabKey: string): FileReviewMode {
  const [mode, setMode] = useSessionState<Record<string, boolean>>('editor.reviewMode', {});
  return {
    active: mode[tabKey] === true,
    toggle: () => setMode((previous) => ({ ...previous, [tabKey]: previous[tabKey] !== true })),
  };
}
