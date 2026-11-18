/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two facts a tool row carries OUTSIDE its body: the way back to a spilled
 * result, and the runtime's reminder that interrupted the call.
 *
 * They used to live in the card's action slot only, so a `compact`, `trace`,
 * `minimal` or `tui` transcript silently dropped both: a result whose output
 * omp capped showed the truncated copy with no way to open the rest, and a
 * reminder envelope read as an ordinary success. A style is a frame, not a
 * capability, so every row renders the same two facts.
 *
 * Rendered as a SIBLING of the row's toggle button (see the line styles), never
 * inside it: `ArtifactChip` is a button itself, and nesting an interactive
 * element inside the row's `<button>` is invalid and loses it to a screen
 * reader.
 */

import { Bell } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import { ArtifactChip } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/ArtifactChip';
import { useTimelineScope } from '@/client/hooks/chat/timeline/scope';
import { artifactRefOf } from '@/shared/lib/chat/tool/artifact';

export function ToolRowActions({ tool, isReminder }: { tool: ToolCallData; isReminder: boolean }) {
  const { sessionId } = useTimelineScope();
  // Nothing to say: render NOTHING, not an empty flex child. The card's action
  // slot and the line styles' row both space their children with a gap, so an
  // empty wrapper would shift the status badge and the chevron by that gap.
  if (!isReminder && !(sessionId && artifactRefOf(tool))) return null;

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <ArtifactChip tool={tool} />
      {isReminder && (
        <span className="inline-flex items-center gap-1 rounded-full bg-error/10 px-2 py-0.5 text-[10px] font-semibold text-error">
          <Bell size={10} /> Reminder
        </span>
      )}
    </span>
  );
}
