import type { ReactNode } from 'preact/compat';
import { useMemo } from 'preact/hooks';
import { Braces } from 'lucide-preact';
import { CopyButton } from '@/client/components/common/CopyButton';
import { NumberedCode } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/numbered-code';
import { useDeferredHighlight } from '@/client/hooks/code/deferred-highlight';

interface JsonCodeBlockProps {
  /** Formatted JSON string to render */
  jsonString: string;
  /** Optional title to show in the header */
  title?: string;
  /** Custom max-height class (default: max-h-56, or max-h-40 if compact) */
  maxHeightClass?: string;
  /** Whether to show header bar (default: true) */
  showHeader?: boolean;
  /** Custom root className */
  className?: string;
  /** Optional compact styling mode */
  compact?: boolean;
  /** Optional custom header icon */
  icon?: ReactNode;
}

export function JsonCodeBlock({
  jsonString,
  title,
  maxHeightClass,
  showHeader = true,
  className = '',
  compact = false,
  icon,
}: JsonCodeBlockProps) {
  const effectiveMaxHeight = maxHeightClass || (compact ? 'max-h-40' : 'max-h-56');
  const lines = useMemo(() => jsonString.split('\n'), [jsonString]);
  // `json` is an eager grammar, so the memo usually answers on the first paint;
  // a cold card still draws the text immediately and colours it a beat later.
  const highlighted = useDeferredHighlight(jsonString, 'json');
  // The gutter's numbers come from the SAME split as the highlighted rows, so
  // the two columns cannot disagree about how many lines there are.
  const numbers = useMemo(() => lines.map((_, index) => index + 1), [lines]);
  const rendered = useMemo(() => {
    const fragments = highlighted.split('\n');
    // Padded, never truncated: a highlight that answered fewer fragments than
    // the source has lines must not shorten the code column, or every number
    // past the gap slides off its line.
    return lines.map((_line, index) => fragments[index] ?? '');
  }, [lines, highlighted]);

  return (
    <div className={`overflow-hidden ${compact ? 'rounded-md' : 'rounded-lg'} border border-ink/8 bg-paper ${className}`}>
      {showHeader && (
        <div className={`flex items-center justify-between border-b border-ink/6 bg-canvas/40 ${compact ? 'px-2.5 py-1' : 'px-3 py-1.5'}`}>
          <div className="flex items-center gap-1.5 min-w-0">
            {icon || <Braces size={compact ? 10.5 : 11} className="text-ink/60 shrink-0" />}
            <span className={`font-mono ${compact ? 'text-[10px]' : 'text-[10.5px]'} font-semibold text-ink truncate`}>
              {title || 'JSON'}
            </span>
            <span className={`rounded bg-ink/5 px-1.5 py-0.2 font-mono ${compact ? 'text-[8.5px]' : 'text-[9px]'} uppercase tracking-wider text-ink/50 shrink-0`}>
              JSON
            </span>
            <span className={`font-mono ${compact ? 'text-[9px]' : 'text-[9.5px]'} text-ink/40 shrink-0`}>
              {lines.length} {lines.length === 1 ? 'line' : 'lines'}
            </span>
          </div>

          <CopyButton
            text={jsonString}
            className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink shrink-0"
            title="Copy JSON"
            onClick={(e) => e.stopPropagation()}
            label="Copy"
          />
        </div>
      )}

      {/* The gutter used to be `text-[10px]` under the code's `text-[11px]`,
          both inheriting `leading-relaxed` — a ratio, so the row boxes were
          16.25px against 17.875px and line 20's number sat 30.9px above its
          code (measured in the browser). `NumberedCode` states one px box and
          one font size for both columns. */}
      <NumberedCode
        numbers={numbers}
        lines={rendered}
        className={`${effectiveMaxHeight} overflow-x-auto`}
        gutterClassName={`border-r border-ink/6 bg-canvas/50 ${compact ? 'py-1.5 pl-2 pr-1.5' : 'py-2 pl-2.5 pr-2'} text-ink/25`}
        codeClassName={compact ? 'p-1.5 text-ink/85' : 'p-2 text-ink/85'}
      />
    </div>
  );
}
