/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor toolbar's cluster ORDER, which is also its hiding priority.
 *
 * `ToolbarRow` hides by ROW ORDER: a cluster takes the row if the budget still
 * covers it, and the first one that does not fit — and every later one — goes
 * into `⋯`. There is no separate priority field, so where a cluster sits IS its
 * priority, and the ordering is therefore worth pinning.
 *
 * The regression this holds: `Save as` sat after the reading aids, and the
 * blame cluster added ahead of it took the last 30px of the 320px floor's row,
 * which put the only control that writes the buffer to a NEW file behind `⋯`
 * while a hover aid stayed on the row. Measured in Chromium on a real file:
 * the row showed `Save file … Show line blame … Full screen` and `Save as…`
 * only as a menu item.
 */

import { describe, expect, test } from 'bun:test';
import { buildEditorClusters, type ToolbarState } from '@/client/components/workspace/editor/toolbar-clusters';

/** The minimum a cluster builder reads; every toggle is off, nothing is disabled. */
function state(): ToolbarState {
  const noop = () => {};
  return {
    byteViewer: false,
    saveButton: null,
    saveDisabled: false,
    onSave: noop,
    hasPreview: true,
    previewLabel: 'Preview',
    isPreview: false,
    onTogglePreview: noop,
    findLabel: 'Find and replace',
    findOpen: false,
    onToggleFind: noop,
    wordWrapLabel: 'Word wrap on',
    wordWrap: false,
    onToggleWordWrap: noop,
    blameInline: false,
    onToggleBlameInline: noop,
    onZoomIn: noop,
    onZoomOut: noop,
    onSaveAs: noop,
    canRevert: false,
    onRevert: noop,
    copyLabel: 'Copy content',
    onCopy: noop,
    onDownload: noop,
    copied: false,
    viewModeActions: [],
    viewModeButtons: null,
    isMaximized: false,
    maximizeLabel: 'Full screen',
    onToggleMaximize: noop,
    maximizeButton: null,
  };
}

describe('buildEditorClusters order', () => {
  test('Save as is placed ahead of every reading aid, so an aid cannot evict it', () => {
    const ids = buildEditorClusters(state()).map((cluster) => cluster.id);
    const saveAs = ids.indexOf('save-as');
    expect(saveAs).toBeGreaterThan(ids.indexOf('save'));
    for (const aid of ['blame', 'zoom', 'copy', 'revert']) {
      expect(saveAs).toBeLessThan(ids.indexOf(aid));
    }
  });

  test('the width modes and full screen are the pinned tail', () => {
    const clusters = buildEditorClusters(state());
    const pinned = clusters.filter((cluster) => cluster.pinned).map((cluster) => cluster.id);
    expect(pinned).toEqual(['save', 'view-modes', 'maximize']);
  });

  test('a byte viewer drops the text-only clusters, Save as among them', () => {
    const ids = buildEditorClusters({ ...state(), byteViewer: true }).map((cluster) => cluster.id);
    for (const absent of ['save', 'save-as', 'find', 'wrap', 'blame', 'zoom']) {
      expect(ids).not.toContain(absent);
    }
    expect(ids).toContain('copy');
  });
});
