/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
 * The rendering itself is the diff panel's own `UnifiedView`/`SplitView`, so a
 * diff in the chat and a diff of the working tree are the same surface rather
 * than two implementations that drift.
 */

import { useMemo, useState } from 'preact/hooks';
import type { ReactNode } from 'preact/compat';
import { Columns2, Rows3, WrapText } from 'lucide-preact';
import { parseUnifiedDiff } from '@/shared/lib/fs/diff-parser';
import { excerptDiffToUnified, isExcerptDiff } from '@/shared/lib/fs/excerpt-diff';
import { getLanguageFromPath } from '@/shared/lib/code/language';
import { CopyButton } from '@/client/components/common/CopyButton';
import { UnifiedView } from '@/client/components/workspace/diff-panel/UnifiedView';
import { SplitView } from '@/client/components/workspace/diff-panel/SplitView';

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

  // Only the view on screen is built: a full-context diff would otherwise
  // allocate both the flat line list and the paired split rows to draw one.
  const parsed = useMemo(
    () => parseUnifiedDiff(unified, { views: split ? 'split' : 'unified' }),
    [unified, split],
  );

  // The excerpt's header carries no filename, so the caller's path is the only
  // name the block can show; the unified header is preferred when it exists.
  const fileLabel = parsed.lines.find((line) => line.type === 'meta')?.text
    ? ''
    : path.split('/').pop() ?? '';
  const language = getLanguageFromPath(path || parsed.splitRows[0]?.right?.text || '');

  if (parsed.lines.length === 0 && parsed.splitRows.length === 0) {
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
          <span className="text-success">+{parsed.additions}</span>
          <span className="text-error">{'\u2212'}{parsed.deletions}</span>
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
          to `auto`, so the view grew to its content (measured 1521px inside a
          288px parent) and `overflow-hidden` clipped it: `scrollHeight ===
          clientHeight` and nothing could scroll.
          A flex column with `min-h-0` gives the view the definite height it
          needs to resolve `h-full` (measured 288px), so the view scrolls its
          own content and this wrapper only bounds it. */}
      <div className={`flex ${maxHeightClass} min-h-0 flex-col overflow-hidden`}>
        {/* No tab key: this diff lives inside a chat card, and the timeline —
            not the card — is what the reader scrolls. */}
        {split ? (
          <SplitView rows={parsed.splitRows} language={language} wordWrap={wordWrap} tabKey={null} />
        ) : (
          <UnifiedView lines={parsed.lines} language={language} wordWrap={wordWrap} tabKey={null} />
        )}
      </div>
    </div>
  );
}
