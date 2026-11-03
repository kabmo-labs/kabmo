/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The WRITE clusters and the two VIEW-MODE toggles — the left half of the editor
 * toolbar, split from `toolbar-clusters.tsx` for the per-file ceiling.
 *
 * The boundary is the two rules that were already there: writes come first and
 * are the ones allowed to be pinned, while the reading aids (find, wrap, zoom,
 * blame) may move into `⋯` on a narrow panel. Keeping the write pair beside the
 * two view toggles is what stops a reading aid from being added in front of them
 * — the measured bug the original comment records (`Save as` pushed into `⋯` by
 * a later, narrower cluster).
 */

import { Eye, EyeOff, MessageSquare, SaveAll } from 'lucide-preact';

import type { ToolbarState } from '@/client/components/workspace/editor/toolbar-clusters';
import { ACTION_CLASS, Toggle } from '@/client/components/workspace/editor/toolbar-toggle';
import type { ToolbarCluster } from '@/client/components/common/toolbar-row';

/** Save and Save as: never a menu row for the panel's own primary action. */
export function writeClusters(state: ToolbarState): ToolbarCluster[] {
  if (state.byteViewer) return [];
  return [
    {
      id: 'save',
      // The primary action of the panel: a menu row must never be the only way to
      // save a file.
      pinned: true,
      actions: [{ label: 'Save file', icon: SaveAll, onSelect: state.onSave, disabled: state.saveDisabled }],
      children: state.saveButton,
    },
    {
      id: 'save-as',
      // Never pinned: it is a rare operation, and the row's space belongs to Save.
      // It IS placed directly after Save, because unpinned clusters take the row in
      // ROW ORDER: measured at the 320px floor, the 26px blame cluster added after
      // it claimed the last 30px and pushed `Save as` into `⋯` — a reading aid
      // evicting a write. Sibling writes outrank reading aids here.
      actions: [{ label: 'Save as…', icon: SaveAll, onSelect: state.onSaveAs }],
      children: (
        <button
          type="button"
          onClick={state.onSaveAs}
          className={`${ACTION_CLASS} hover:bg-ink/5 hover:text-ink`}
          title="Save the buffer to a new file"
          aria-label="Save as"
        >
          <SaveAll size={14} />
        </button>
      ),
    },
  ];
}

/**
 * The review toggle — only where there is a rendered document to judge.
 *
 * Annotating the SOURCE has no blocks, so the button exists only while the
 * preview branch is the one on screen: a control that switched a mode nothing
 * could use would be a lie about what the panel can do.
 */
export function reviewCluster(state: ToolbarState): ToolbarCluster[] {
  if (!state.hasReview) return [];
  const label = state.isReviewing ? 'Exit review mode' : 'Review this document';
  return [
    {
      id: 'review',
      actions: [{ label, icon: MessageSquare, onSelect: state.onToggleReview, active: state.isReviewing }],
      children: (
        <Toggle
          label={label}
          pressed={state.isReviewing}
          title={
            state.isReviewing
              ? 'Review mode is on — click a block to judge it'
              : 'Review: click blocks to mark them good or needing work'
          }
          onClick={state.onToggleReview}
        >
          <MessageSquare size={14} />
        </Toggle>
      ),
    },
  ];
}

/** The rendered-view toggle (markdown prose, CSV grid, SVG picture). */
export function previewClusters(state: ToolbarState): ToolbarCluster[] {
  if (!state.hasPreview) return [];
  return [
    {
      id: 'preview',
      actions: [
        {
          label: state.previewLabel,
          icon: state.isPreview ? EyeOff : Eye,
          onSelect: state.onTogglePreview,
          active: state.isPreview,
        },
      ],
      children: (
        <Toggle label={state.previewLabel} pressed={state.isPreview} onClick={state.onTogglePreview}>
          {state.isPreview ? <EyeOff size={14} /> : <Eye size={14} />}
        </Toggle>
      ),
    },
  ];
}
