import { useMemo } from 'preact/hooks';

/**
 * Full-panel placeholder shown while a session's committed history is being
 * fetched — the timeline container paints before /api/chat/:id resolves, and
 * on a phone the fetch+parse of a large session is easily hundreds of
 * milliseconds. Covers the whole chat timeline panel (message body + composer
 * area) identically on desktop and mobile, so switching sessions never shows
 * a half-drawn view. Neutral paper-shaped rows; no spinners, no layout shift
 * once the real rows replace it.
 */

interface SkeletonRow {
  role: 'user' | 'ai';
  width: string;
  lines: number;
}

const SKELETON_ROWS: SkeletonRow[] = [
  { role: 'user', width: '58%', lines: 1 },
  { role: 'ai', width: '100%', lines: 3 },
  { role: 'user', width: '40%', lines: 1 },
  { role: 'ai', width: '92%', lines: 2 },
  { role: 'user', width: '52%', lines: 2 },
  { role: 'ai', width: '100%', lines: 4 },
];

function SkeletonBubble({ row, index }: { row: SkeletonRow; index: number }) {
  return (
    <div className={`flex ${row.role === 'user' ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className="rounded-lg bg-ink/5 border border-ink/5 px-3 py-2 space-y-1.5"
        style={{ width: row.width, maxWidth: '85%' }}
      >
        {Array.from({ length: row.lines }, (_, l) => (
          <div
            key={l}
            className="h-2.5 rounded bg-ink/8 animate-pulse"
            style={{ width: l === row.lines - 1 ? '62%' : '100%', animationDelay: `${index * 120 + l * 60}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

export function SessionSkeleton() {
  const rows = useMemo(() => SKELETON_ROWS, []);

  return (
    <div aria-hidden className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Timeline body — mirrors the real container's padding in both variants. */}
      <div className="flex-1 min-h-0 overflow-hidden pl-4 pr-3 py-3 pb-8 sm:p-4 sm:pb-10">
        <div className="mx-auto w-full max-w-[970px]">
          {rows.map((row, i) => (
            <SkeletonBubble key={i} row={row} index={i} />
          ))}
        </div>
      </div>

      {/* Composer area — skeleton chat input, mirrors the real footer padding. */}
      <div className="flex-shrink-0 px-3 pt-1 pb-3 sm:p-4 sm:pt-1">
        <div className="mx-auto w-full max-w-[970px]">
          <div className="rounded-md border border-ink/20 bg-paper p-3 space-y-2">
            <div className="h-9 rounded bg-ink/8 animate-pulse" style={{ animationDelay: '720ms' }} />
            <div className="flex items-center justify-between">
              <div className="h-5 w-28 rounded bg-ink/8 animate-pulse" style={{ animationDelay: '840ms' }} />
              <div className="h-7 w-7 rounded bg-ink/8 animate-pulse" style={{ animationDelay: '960ms' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Slim inline indicator above the timeline while an older history window is
 *  being fetched (scroll-to-top paging). */
export function LoadingOlderIndicator() {
  return (
    <div className="flex justify-center py-2" role="status">
      <div className="flex items-center gap-1.5 text-ink/40 text-[11px] font-mono">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-ink/30 animate-pulse" />
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-ink/30 animate-pulse" style={{ animationDelay: '150ms' }} />
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-ink/30 animate-pulse" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}
