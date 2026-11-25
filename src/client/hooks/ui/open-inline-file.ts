/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Opening the file an inline code span names.
 *
 * The detector (`inline-file.ts`) decides whether a span is a file at render
 * time; this is the click half, and it is the only place that touches the
 * network. A path with a directory opens immediately — the tab's root is the
 * active workspace, exactly what the agent wrote against. A bare filename is
 * resolved against the quick-open index (`/api/fs/list`, the same capped walk
 * the picker uses) and then opened, sent to the picker, or opened as written
 * when nothing matched; see `chooseFileTarget` for the three cases and why the
 * middle one exists.
 *
 * The line request is published BEFORE the open, the order the search panel
 * uses: the editor that finds the file on screen already has it in hand, and
 * the tab entry cannot carry it (it is persisted, so a reload would re-fire a
 * jump that was already served).
 */

import { fetchQuickOpenIndex } from '@/client/hooks/editor/quick-open';
import { openFileInEditor } from '@/client/hooks/ui/open-file';
import { openPalette } from '@/client/lib/commands/overlays';
import { setLineReveal } from '@/client/lib/line-reveal';
import { pluginContext } from '@/client/lib/plugins/context';
import { chooseFileTarget, type InlineFileTarget } from '@/shared/lib/fs/open-reference';
import {
  INLINE_FILE_ATTRIBUTE,
  INLINE_FILE_LINE_ATTRIBUTE,
} from '@/shared/lib/markdown/inline-file';

/** The request a marked chip carries, or null when it carries no path. */
export function readInlineFileChip(chip: HTMLElement): InlineFileTarget | null {
  const path = chip.getAttribute(INLINE_FILE_ATTRIBUTE);
  if (!path) return null;
  const line = Number(chip.getAttribute(INLINE_FILE_LINE_ATTRIBUTE));
  return Number.isFinite(line) && line > 0 ? { path, line } : { path };
}

/** Open (or locate) the file one inline chip names. Callers fire and forget. */
export async function openInlineFileReference(reference: InlineFileTarget): Promise<void> {
  const root = pluginContext().workspacePath ?? undefined;

  if (root && !reference.path.includes('/')) {
    const entries = await fetchQuickOpenIndex(root);
    const target = chooseFileTarget(reference, entries);
    if (target.kind === 'pick') {
      openPalette('files', { query: target.query });
      return;
    }
    open(target.path, target.line, root);
    return;
  }

  open(reference.path, reference.line, root);
}

/** The click/keyboard handler's whole job: read the chip, then act on it. */
export function activateInlineFileChip(chip: HTMLElement): void {
  const reference = readInlineFileChip(chip);
  if (!reference) return;
  void openInlineFileReference(reference);
}

function open(path: string, line: number | undefined, root: string | undefined): void {
  if (line !== undefined) setLineReveal({ path, line });
  openFileInEditor({ path, root });
}
