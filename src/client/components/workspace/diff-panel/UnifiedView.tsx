import { useMemo } from 'preact/hooks';
import type { DiffLine } from '@/shared/lib/fs/diff-parser';
import { highlightLines } from '@/shared/lib/code/syntax-highlight';
import { useSyntaxReady } from '@/client/hooks/ui/syntax-ready';
import { useScrollRestore } from '@/client/hooks/editor/use-scroll-restore';

interface UnifiedViewProps {
  lines: DiffLine[];
  language: string;
  /** Wrap long lines instead of scrolling horizontally. */
  wordWrap: boolean;
  /**
   * The diff tab these rows belong to, so its scroll offset is remembered — or
   * null for a caller with no tab of its own (a diff inside a chat tool card,
   * where the timeline owns the scrolling).
   */
  tabKey: string | null;
}

export function UnifiedView({ lines, language, wordWrap, tabKey }: UnifiedViewProps) {
  const syntaxReady = useSyntaxReady();
  // The unified and split shapes are different row counts and heights for the
  // same diff, so each keeps its own offset (see `ScrollSurface`).
  const scroll = useScrollRestore({ tabKey, surface: 'unified' });

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

  if (lines.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink/40 font-mono text-xs p-8">
        No differences between working file and target.
      </div>
    );
  }

  return (
    <div
      ref={scroll.ref}
      onScroll={scroll.onScroll}
      data-testid="diff-scroller"
      className="w-full h-full overflow-auto font-mono text-xs select-text bg-paper text-ink code-surface"
    >
      {/* The room under the last row belongs to the content, not the scroller:
          a scroll container's own bottom padding is not part of its scrollable
          overflow, so the padding has to sit inside it to have any effect. */}
      <div className={`pb-4 ${wordWrap ? 'w-full' : 'w-max min-w-full'}`}>
        {/* Wrap needs `table-fixed`: auto layout sizes a column by its widest
            cell's UNAMBIGUOUS minimum (`overflow-wrap: break-word` does not
            lower it), so a long line would still widen the table and scroll
            instead of wrapping. Fixed layout takes the width from the row's
            own box, which is what makes the cell's wrap rule effective. */}
        <table className={`border-collapse ${wordWrap ? 'table-fixed w-full' : 'w-max min-w-full'}`}>
          <tbody>
            {lines.map((line, idx) => {
              if (line.type === 'meta') {
                return (
                  <tr key={idx} className="bg-canvas border-y border-ink/10 text-meta select-none">
                    <td className="w-12 text-center py-1 px-2 text-[10px] opacity-60 border-r border-ink/10 font-mono">...</td>
                    <td className="w-12 text-center py-1 px-2 text-[10px] opacity-60 border-r border-ink/10 font-mono">...</td>
                    <td className="py-1 px-3 text-[11px] font-semibold text-meta font-mono tracking-tight">{line.text}</td>
                  </tr>
                );
              }

              const isAdd = line.type === 'add';
              const isDel = line.type === 'del';

              return (
                <tr
                  key={idx}
                  className={`transition-colors group ${
                    isAdd
                      ? 'bg-success/10 hover:bg-success/15'
                      : isDel
                      ? 'bg-error/10 hover:bg-error/15'
                      : 'hover:bg-ink/[0.03]'
                  }`}
                >
                  {/* Old line number. Top-aligned when the row wraps, or the
                      number would float to the middle of a multi-line cell
                      instead of naming its first line. */}
                  <td
                    className={`w-12 py-0.5 px-2 text-right text-[10px] select-none border-r border-ink/10 font-mono ${
                      wordWrap ? 'align-top' : ''
                    } ${
                      isDel
                        ? 'bg-error/15 text-error font-semibold'
                        : isAdd
                        ? 'bg-success/15 text-success/70'
                        : 'bg-canvas/50 text-ink/40'
                    }`}
                  >
                    {line.oldLineNumber || ''}
                  </td>

                  {/* New line number */}
                  <td
                    className={`w-12 py-0.5 px-2 text-right text-[10px] select-none border-r border-ink/10 font-mono ${
                      wordWrap ? 'align-top' : ''
                    } ${
                      isAdd
                        ? 'bg-success/15 text-success font-semibold'
                        : isDel
                        ? 'bg-error/15 text-error/70'
                        : 'bg-canvas/50 text-ink/40'
                    }`}
                  >
                    {line.newLineNumber || ''}
                  </td>

                  {/* Change prefix & code text */}
                  <td className={`py-0.5 px-3 text-ink pr-6 ${wordWrap ? 'whitespace-pre-wrap break-words align-top' : 'whitespace-pre'}`}>
                    <span
                      className={`inline-block w-4 text-center select-none font-bold ${
                        isAdd ? 'text-success' : isDel ? 'text-error' : 'opacity-0'
                      }`}
                    >
                      {isAdd ? '+' : isDel ? '-' : ' '}
                    </span>
                    <span
                      className="shiki"
                      dangerouslySetInnerHTML={{
                        __html: line.text ? htmlByIndex[idx] || '&nbsp;' : '&nbsp;',
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
