/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One activity-bar button, drawn from the catalog entry it belongs to.
 *
 * It is both a drag SOURCE and a drop TARGET: the drop is what moves the
 * button, and `dragover` is the only moment a target can accept it. Both rails
 * and every kind of panel share it, so the marks, the pressed state and the
 * drag affordance cannot drift between the left dock and the right column.
 */

import type { TargetedDragEvent } from 'preact';
import type { ResolvedPanel } from '@/client/components/workspace/plugin-panel/catalog';
import { PanelMark } from '@/client/components/common/panel-mark';
import { PANEL_MARK_SIZE } from '@/shared/lib/workspace/right-panels';

interface PanelButtonProps {
  panel: ResolvedPanel;
  draggable: boolean;
  isActive: boolean;
  isDragging: boolean;
  onClick: () => void;
  onDragStart: (event: TargetedDragEvent<HTMLElement>) => void;
  onDragOver: (event: TargetedDragEvent<HTMLElement>) => void;
  onDrop: (event: TargetedDragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  showGitDot: boolean;
}

export function PanelButton({
  panel,
  draggable,
  isActive,
  isDragging,
  onClick,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  showGitDot,
}: PanelButtonProps) {
  return (
    <button
      className={`relative w-full h-10 flex items-center justify-center transition-colors ${
        panel.side === 'left' ? 'border-r-2' : 'border-l-2'
      } ${
        isActive ? 'text-ink border-ink bg-ink/5' : 'text-ink/40 border-transparent hover:text-ink hover:bg-ink/5'
      } ${isDragging ? 'opacity-40 cursor-grabbing' : 'cursor-pointer'}`}
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      title={panel.title}
      aria-label={panel.title}
      // A rail button is a TOGGLE: it says which view the column is showing.
      // Without this the state existed only as a border colour, which assistive
      // tech cannot read and measured as `aria-pressed: null` on all six marks.
      aria-pressed={isActive}
    >
      {/* The mark's wrapper carries the state as OPACITY, not as a text colour:
          a `text-ink/40` here outranks the colour mode's hue rule, which is what
          kept this rail monochrome while the panels behind it were tinted. In
          the monochrome mode nothing dims the ink twice — `[data-idle]` is only
          read under `[data-icon-style="color"]`.

          The colour itself is NOT decided here: `PanelMark` stamps the same
          `--panel-hue` the phone's chip strip and Settings read, so this button
          cannot disagree with them about what `Files` looks like. */}
      <PanelMark
        className="panel-rail-mark inline-flex"
        panelId={panel.id}
        builtin={panel.builtin}
        icon={panel.builtin ? panel.icon : undefined}
        name={panel.builtin ? panel.label : panel.name}
        {...(panel.iconUrl ? { iconUrl: panel.iconUrl } : {})}
        {...(panel.color ? { color: panel.color } : {})}
        size={PANEL_MARK_SIZE}
        idle={!isActive}
      />
      {showGitDot ? (
        <span
          className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-info"
          title="Ada perubahan git"
        />
      ) : null}
    </button>
  );
}
