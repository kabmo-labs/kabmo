import { useMemo } from 'preact/hooks';
import { getLanguageFromPath } from '@/shared/lib/code/language';
import { useDeferredHighlightLines } from '@/client/hooks/code/deferred-highlight';
import { CopyButton } from '@/client/components/common/CopyButton';
import { MAX_OUTPUT_LINES, truncateTailLines } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/truncate';

/** One `121:code` row of an omp excerpt. */
interface ExcerptRow {
  /** The line's number in the file, as omp printed it. */
  num: string;
  code: string;
}

/** `121:code`, `18:` (an empty line, which keeps its number) — the prefix is a
 *  gutter, so it is split off rather than parsed as part of the code. */
const ROW_RE = /^\s*(\d+):[ \t]?([\s\S]*)$/;

/** Split an omp excerpt into its gutter numbers and its code. */
function splitExcerptRows(lines: string[]): ExcerptRow[] {
  const rows: ExcerptRow[] = [];
  for (const line of lines) {
    const match = ROW_RE.exec(line);
    if (match) rows.push({ num: match[1], code: match[2] });
    else rows.push({ num: '', code: line });
  }
  return rows;
}

interface ExcerptCodeProps {
  /** Raw `121:code` rows, verbatim from the tool result. */
  lines: string[];
  /** File the excerpt belongs to — selects the grammar and titles the block. */
  path?: string;
  /** Read-snapshot tag omp printed beside the path, when it printed one. */
  tag?: string;
}

/** A numbered excerpt of a file: the gutter numbers omp printed, beside the
 *  code they belong to, highlighted in the file's own grammar.
 *
 *  The numbers are gutter, not content — the raw result is a single plain code
 *  block with `121:` welded onto every line, which reads as an excerpt of
 *  nothing in particular. */
export function ExcerptCode({ lines, path = '', tag }: ExcerptCodeProps) {
  const rows = useMemo(() => splitExcerptRows(lines), [lines]);
  const lang = getLanguageFromPath(path);

  // Only the tail is rendered, so only the tail is highlighted — tokenizing the
  // dropped head would be work whose output is thrown away. The tokenizer itself
  // runs off the expand that asked for it (see `deferred-highlight`).
  const { code: visibleCode, hidden } = useMemo(() => {
    const code = rows.map((row) => row.code);
    const truncated = truncateTailLines(code.join('\n'), MAX_OUTPUT_LINES);
    const visible = truncated.skipped > 0 ? code.slice(truncated.skipped) : code;
    return { code: visible.join('\n'), hidden: truncated.skipped };
  }, [rows]);
  const html = useDeferredHighlightLines(visibleCode, lang);

  const visibleRows = hidden > 0 ? rows.slice(hidden) : rows;

  return (
    <div className="overflow-hidden rounded-lg border border-ink/8 bg-paper">
      {path && (
        <div className="flex min-w-0 items-center gap-2 border-b border-ink/6 bg-canvas/40 px-2.5 py-1.5">
          <span className="truncate font-mono text-[10.5px] font-medium text-ink/70">{path}</span>
          {tag && (
            <span className="shrink-0 rounded bg-ink/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ink/45">
              {tag}
            </span>
          )}
          <CopyButton
            text={visibleRows.map((row) => row.code).join('\n')}
            className="ml-auto flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink"
            iconSize={10}
            label="Copy"
          />
        </div>
      )}
      {hidden > 0 && (
        <div className="border-b border-ink/6 px-2.5 py-1 font-mono text-[9.5px] text-ink/45">
          … {hidden} earlier lines hidden
        </div>
      )}
      <div className="flex max-h-80 items-start overflow-x-auto select-text">
        <div
          className="sticky left-0 z-10 flex-shrink-0 select-none border-r border-ink/6 bg-canvas/60 py-2 pl-2.5 pr-2 text-right font-mono text-[10.5px] leading-[20px] tabular-nums text-ink/25"
          aria-hidden="true"
        >
          {visibleRows.map((row, index) => (
            <div key={index} className="h-[20px] leading-[20px]">
              {row.num}
            </div>
          ))}
        </div>
        <div className="shiki m-0 flex-1 min-w-max py-2 pl-3 pr-4 font-mono text-[11px] leading-[20px] whitespace-pre text-ink/85">
          {visibleRows.map((_row, index) => (
            <div
              key={index}
              className="h-[20px] leading-[20px]"
              dangerouslySetInnerHTML={{ __html: html[index] || '' }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
