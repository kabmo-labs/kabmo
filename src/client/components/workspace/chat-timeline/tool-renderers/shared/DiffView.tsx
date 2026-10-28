/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The diff of an `edit`/`write` tool call, in the chat timeline.
 *
 * Two dialects arrive here and only one of them was handled. git's own unified
 * diff has `@@`/`---`/`+++` headers; **omp's excerpt diff does not** — every row
 * carries the file's line number as a gutter (`-43|  return new Promise(…)`).
 * The previous parser read a leading `-`/`+` and kept the rest, so the gutter
 * was painted as code: measured in the browser, the row rendered
 * `43|  return new Promise(…)` and the header named a file called `diff`.
 *
 * `excerptDiffToUnified` (`shared/lib/fs/excerpt-diff.ts`) converts that shape
 * first, so ONE parser serves both — and because the conversion recovers the
 * gutter numbers, the rows get real line numbers instead of `...`.
 *
 * The rendering is the diff panel's own merge view, so a diff in the chat and a
 * diff of the working tree are the same surface rather than two implementations
 * that drift. A card has only the PATCH, not the two documents, so the two sides
 * are reconstructed from the parsed rows — a context row appears on both, a `-`
 * only on the original, a `+` only on the new one.
 */

import { useMemo, useState } from 'preact/hooks';
import type { ReactNode } from 'preact/compat';
import { Columns2, Rows3, WrapText } from 'lucide-preact';
import { patchSides } from '@/shared/lib/fs/patch-sides';
import { excerptDiffToUnified, isExcerptDiff } from '@/shared/lib/fs/excerpt-diff';
import { getLanguageFromPath } from '@/shared/lib/code/language';
import { CopyButton } from '@/client/components/common/CopyButton';
import { MergeDiffView } from '@/client/components/workspace/diff-panel/MergeDiffView';
import { useEditorFontStack } from '@/client/hooks/editor/font';
import { EDITOR_DEFAULT_FONT_SIZE } from '@/shared/lib/code/editor/typography';

/** A small icon-only toolbar button, `aria-pressed` for its own state. */
function ToggleButton({
  pressed,
  onClick,
  label,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      className={`flex cursor-pointer items-center rounded px-1.5 py-0.5 transition-colors ${
        pressed ? 'bg-ink/10 text-ink' : 'text-ink/45 hover:bg-ink/5 hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

interface DiffViewProps {
  text: string;
  /** File the diff belongs to — selects the grammar. */
  path?: string;
  /**
   * Height ceiling for the rows. The card's own default (`max-h-72`) bounds a
   * diff inside a timeline card; the full-output reader passes `max-h-none` so
   * the modal's body is the scroller instead of a 288px box inside it.
   */
  maxHeightClass?: string;
}

/** Diff untuk details.patch / details.diff dari toolResult. */
export function DiffView({ text, path = '', maxHeightClass = 'max-h-72' }: DiffViewProps) {
  const [split, setSplit] = useState(false);
  const [wordWrap, setWordWrap] = useState(true);

  // omp's excerpt is converted first; a git unified diff passes through.
  const unified = useMemo(() => (isExcerptDiff(text) ? excerptDiffToUnified(text) : text), [text]);

  // A card has a PATCH and no documents, so the two sides are rebuilt from it:
  // context on both, `-` on the original, `+` on the new one. That is the same
  // alignment the merge view would compute from two files, restricted to the
  // hunks the patch carries.
  const sides = useMemo(() => patchSides(unified), [unified]);
  const editorFontFamily = useEditorFontStack();

  // The excerpt's header carries no filename, so the caller's path is the only
  // name the block can show — unless the patch names itself.
  const fileLabel = sides.hasHunk ? '' : (path.split('/').pop() ?? '');
  const language = getLanguageFromPath(path || sides.next.split('\n')[0] || '');

  if (sides.rows === 0) {
    return (
      <pre className="max-h-48 overflow-auto rounded-lg border border-ink/8 bg-paper p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-ink/80 select-text">
        {text}
      </pre>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-ink/8">
      <div className="flex items-center gap-2 border-b border-ink/8 bg-paper px-2.5 py-1.5">
        {fileLabel && (
          <span className="truncate font-mono text-[10.5px] text-ink/60">{fileLabel}</span>
        )}
        <span className="flex items-center gap-1.5 font-mono text-[10px]">
          <span className="text-success">+{sides.additions}</span>
          <span className="text-error">{'\u2212'}{sides.deletions}</span>
        </span>
        <span className="ml-auto flex items-center gap-1">
          <ToggleButton
            pressed={!split}
            onClick={() => setSplit(false)}
            label="Unified view"
          >
            <Rows3 size={12} />
          </ToggleButton>
          <ToggleButton pressed={split} onClick={() => setSplit(true)} label="Split view">
            <Columns2 size={12} />
          </ToggleButton>
          <ToggleButton
            pressed={wordWrap}
            onClick={() => setWordWrap((current) => !current)}
            label="Toggle word wrap"
          >
            <WrapText size={12} />
          </ToggleButton>
          <CopyButton
            text={text}
            className="flex cursor-pointer items-center rounded px-1.5 py-0.5 text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink"
            iconSize={11}
            ariaLabel="Copy diff"
            title="Copy diff"
          />
        </span>
      </div>
      {/* The panel views are `w-full h-full overflow-auto`, but their parent in
          the diff panel has a DEFINITE height while this one only has a
          `max-height` — and `height: 100%` against an auto-height box resolves
          to `auto`. `min-h-0` on this flex column is necessary but NOT
          sufficient: it lets the item shrink, while what the view needs is a
          height to shrink TO, and a `max-height` ancestor does not give a
          percentage one. Measured with only this wrapper in place: the editor
          root resolved to 1847px inside the 288px box and `overflow-hidden`
          clipped it, so `scrollHeight === clientHeight` and a 30-line edit card
          showed 9 rows with no way to reach the rest — in both shapes.
          `[data-code-surface]` in `tailwind.css` is the other half: the host is
          a column flex container and the editor root a shrinking item, which
          gives it the height through layout instead of through a percentage. */}
      <div className={`flex ${maxHeightClass} min-h-0 flex-col overflow-hidden`}>
        {/* No tab key: this diff lives inside a chat card, and the timeline —
            not the card — is what the reader scrolls. No counts either: the
            header above already prints them from the patch. */}
        <MergeDiffView
          original={sides.original}
          next={sides.next}
          language={language}
          viewMode={split ? 'split' : 'unified'}
          // Collapsed gaps: the reconstructed sides carry blank padding up to
          // each hunk's real line, so showing every row would draw thousands of
          // empty lines between two changes.
          contentMode="diff"
          wordWrap={wordWrap}
          ignoreWhitespace={false}
          tabKey={null}
          empty={false}
          fontFamily={editorFontFamily}
          fontSize={EDITOR_DEFAULT_FONT_SIZE}
        />
      </div>
    </div>
  );
}
