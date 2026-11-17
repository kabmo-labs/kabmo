import { useMemo } from 'preact/hooks';
import { ChevronDown, ChevronUp } from 'lucide-preact';
import { getLanguageFromPath } from '@/shared/lib/code/language';
import { highlightLines } from '@/shared/lib/code/syntax-highlight';
import { useSyntaxReady } from '@/client/hooks/ui/syntax-ready';

interface DiffLineItem {
  type: 'add' | 'del' | 'context' | 'meta';
  text: string;
  oldNum?: number;
  newNum?: number;
}

/**
 * A run of context lines hidden by the "Collapse context" toggle.
 *
 * It is a row of its own rather than a shorter slice so the reader can see that
 * lines are missing and how many — a diff that silently drops its middle reads
 * as a smaller change than it is.
 */
interface ElidedRow {
  type: 'elided';
  count: number;
}

/** Context lines kept at each end of a collapsed run. */
const CONTEXT_KEEP = 3;

/**
 * Hide the middle of a long run of unchanged lines.
 *
 * Only the `context` rows are elided; a hunk header (`meta`) and every changed
 * line stay, which is what makes the collapsed view a summary of the change
 * rather than a truncated diff. Each kept row carries its ORIGINAL index, since
 * the highlighted HTML is keyed to the full parse and a re-indexed row would
 * paint a different line's tokens.
 */
function collapseContext(
  rows: DiffLineItem[],
): Array<{ row: DiffLineItem | ElidedRow; index: number }> {
  const out: Array<{ row: DiffLineItem | ElidedRow; index: number }> = [];
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].type !== 'context') {
      out.push({ row: rows[i], index: i });
      continue;
    }
    let end = i;
    while (end < rows.length && rows[end].type === 'context') end += 1;
    const run = end - i;
    if (run > CONTEXT_KEEP * 2 + 1) {
      for (let k = i; k < i + CONTEXT_KEEP; k += 1) out.push({ row: rows[k], index: k });
      out.push({ row: { type: 'elided', count: run - CONTEXT_KEEP * 2 }, index: -1 });
      for (let k = end - CONTEXT_KEEP; k < end; k += 1) out.push({ row: rows[k], index: k });
    } else {
      for (let k = i; k < end; k += 1) out.push({ row: rows[k], index: k });
    }
    i = end - 1;
  }
  return out;
}

interface CommitDiffViewerProps {
  diffText?: string;
  isLoading?: boolean;
  filePath?: string;
  /**
   * Whether the diff on hand was read with the whole file around the change.
   * The toggle is CONTROLLED because expanding it is a re-read, not a client
   * expansion: git's default patch carries three context lines, so there is
   * nothing more in the payload to reveal.
   */
  fullContext?: boolean;
  onToggleContext?: () => void;
}

export function CommitDiffViewer({ diffText, isLoading, filePath, fullContext = false, onToggleContext }: CommitDiffViewerProps) {
  const syntaxReady = useSyntaxReady();

  const lines = useMemo(() => {
    if (!diffText) return [];
    const parsed: DiffLineItem[] = [];
    let oldCounter = 1;
    let newCounter = 1;

    const rawLines = diffText.split(/\r?\n/);
    let hasHunk = rawLines.some((l) => l.startsWith('@@'));

    // If no hunk header is found, but lines exist, wrap into a synthesized initial hunk
    const linesToProcess = hasHunk
      ? rawLines
      : [`@@ -0,0 +1,${rawLines.length} @@`, ...rawLines.map((l) => (l.startsWith('+') || l.startsWith('-') ? l : `+${l}`))];

    for (const line of linesToProcess) {
      if (
        line.startsWith('diff --git') ||
        line.startsWith('index ') ||
        line.startsWith('---') ||
        line.startsWith('+++') ||
        line.startsWith('new file mode') ||
        line.startsWith('deleted file mode') ||
        line.startsWith('similarity index') ||
        line.startsWith('old mode') ||
        line.startsWith('new mode') ||
        line.startsWith('\\ No newline')
      ) {
        continue;
      }
      if (line.startsWith('@@')) {
        // Parse hunk header @@ -oldStart,oldLen +newStart,newLen @@
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          oldCounter = parseInt(match[1], 10);
          newCounter = parseInt(match[2], 10);
        }
        parsed.push({ type: 'meta', text: line });
      } else if (line.startsWith('+')) {
        parsed.push({ type: 'add', text: line.slice(1), newNum: newCounter++ });
      } else if (line.startsWith('-')) {
        parsed.push({ type: 'del', text: line.slice(1), oldNum: oldCounter++ });
      } else {
        const text = line.startsWith(' ') ? line.slice(1) : line;
        parsed.push({ type: 'context', text, oldNum: oldCounter++, newNum: newCounter++ });
      }
    }
    return parsed;
  }, [diffText]);

  const language = getLanguageFromPath(filePath);
  const htmlByIndex = useMemo(() => {
    const out = new Array<string>(lines.length).fill('');
    let start = -1;
    const flush = (end: number) => {
      if (start < 0) return;
      const html = highlightLines(lines.slice(start, end).map((l) => l.text).join('\n'), language);
      for (let i = start; i < end; i++) out[i] = html[i - start] ?? '';
      start = -1;
    };
    lines.forEach((line, idx) => {
      if (line.type === 'meta') flush(idx);
      else if (start < 0) start = idx;
    });
    flush(lines.length);
    return out;
  }, [lines, language, syntaxReady]);

  // The toggle's label and the elision both follow the SERVER's answer, so the
  // two cannot disagree about whether the whole file is on screen.
  const rendered = useMemo(
    () => (fullContext ? lines.map((row, index) => ({ row, index })) : collapseContext(lines)),
    [lines, fullContext],
  );

  if (isLoading) {
    return (
      <div className="my-2 p-4 rounded bg-canvas border border-ink/10 text-muted font-mono text-xs flex items-center justify-center">
        Loading commit diff...
      </div>
    );
  }

  if (!diffText || lines.length === 0) {
    return (
      <div className="my-2 p-3 rounded bg-canvas border border-ink/10 text-muted font-mono text-xs text-center">
        No diff content available for this file.
      </div>
    );
  }

  // Segment lines into blocks of context / changes
  return (
    <div className="my-2 rounded border border-ink/15 bg-paper overflow-hidden text-[11px] font-mono leading-relaxed text-ink">
      <div className="flex items-center justify-between px-3 py-1.5 bg-canvas border-b border-ink/10 text-ink/70 text-[10.5px]">
        <span className="font-semibold text-muted">Diff preview</span>
        <button
          type="button"
          onClick={onToggleContext}
          disabled={!onToggleContext}
          className="hover:text-ink flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default"
          title={fullContext ? 'Show only the changed hunks' : 'Read the whole file around the change'}
          aria-pressed={fullContext}
        >
          {fullContext ? (
            <>
              <ChevronUp size={12} aria-hidden="true" /> Collapse context
            </>
          ) : (
            <>
              <ChevronDown size={12} aria-hidden="true" /> Expand all context
            </>
          )}
        </button>
      </div>

      <div className="overflow-x-auto max-h-72 select-text">
        <div className="w-max min-w-full divide-y divide-ink/[0.04]">
          {rendered.map(({ row, index }, position) => {
            if (row.type === 'elided') {
              return (
                <div
                  key={`elided-${position}`}
                  className="px-3 py-1 bg-canvas text-muted text-[10px] text-center select-none"
                  title={`${row.count} unchanged line(s) hidden`}
                >
                  ⋯ {row.count} unchanged line{row.count === 1 ? '' : 's'} hidden ⋯
                </div>
              );
            }

            const line = row;
            const idx = index;
            if (line.type === 'meta') {
              return (
                <div
                  key={idx}
                  className="flex items-center gap-2 px-3 py-1 bg-canvas border-y border-ink/10 text-muted text-[10px] font-semibold"
                >
                  <span>↕</span>
                  <span>{line.text}</span>
                </div>
              );
            }

            const isAdd = line.type === 'add';
            const isDel = line.type === 'del';

            return (
              <div
                key={idx}
                className={`flex items-start font-mono ${
                  isAdd
                    ? 'bg-success/10 hover:bg-success/15'
                    : isDel
                    ? 'bg-error/10 hover:bg-error/15'
                    : 'text-ink hover:bg-ink/[0.02]'
                }`}
              >
                {/* Line numbers column */}
                <div
                  className={`w-10 flex-shrink-0 text-right pr-2 py-0.5 select-none border-r border-ink/10 text-[10px] tabular-nums font-mono ${
                    isDel
                      ? 'bg-error/15 text-ink/80 font-semibold'
                      : isAdd
                      ? 'bg-success/15 text-ink/80'
                      : 'bg-canvas/50 text-muted'
                  }`}
                >
                  {line.oldNum ?? (isAdd ? '+' : '')}
                </div>
                <div
                  className={`w-10 flex-shrink-0 text-right pr-2 py-0.5 select-none border-r border-ink/10 text-[10px] tabular-nums font-mono ${
                    isAdd
                      ? 'bg-success/15 text-ink/80 font-semibold'
                      : isDel
                      ? 'bg-error/15 text-ink/80'
                      : 'bg-canvas/50 text-muted'
                  }`}
                >
                  {line.newNum ?? (isDel ? '-' : '')}
                </div>

                {/* Diff marker */}
                <div
                  className={`w-4 flex-shrink-0 text-center py-0.5 select-none font-bold ${
                    isAdd || isDel ? 'text-ink/80' : 'opacity-0'
                  }`}
                >
                  {isAdd ? '+' : isDel ? '-' : ' '}
                </div>

                {/* Code text */}
                <div className="flex-1 py-0.5 pr-3 whitespace-pre text-ink">
                  {line.text ? (
                    <span className="shiki" dangerouslySetInnerHTML={{ __html: htmlByIndex[idx] }} />
                  ) : (
                    ' '
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
