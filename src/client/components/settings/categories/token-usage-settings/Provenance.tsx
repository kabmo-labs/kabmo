import type { UsageIndexState } from '@/shared/types';

interface UsageProvenanceProps {
  index: UsageIndexState;
  /** Epoch ms the payload was built, so the age is independent of clock skew. */
  generatedAt: number;
  providers: number;
}

/** `3 s` / `2 min` / `1 h` — the index's own age, not the request's. */
function ageLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1_000) return 'just now';
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

/**
 * The footer: where the numbers came from and how fresh they are.
 *
 * It used to be a hardcoded sentence (`… · 0.1s`, `(1 outside the window)`) that
 * described a scan that had not happened. Every value here comes from the
 * index's own report, and `rechecking` is used only once there is an index to
 * recheck — a 40 ms background pass is not "indexing" and must not flash over
 * data the user is reading.
 */
export function UsageProvenance({ index, generatedAt, providers }: UsageProvenanceProps) {
  const building = index.state === 'building';
  const hasIndex = index.indexedAt > 0;
  const status = !hasIndex
    ? index.state === 'failed'
      ? 'Index failed'
      : 'No sessions indexed yet'
    : building
      ? `Updated ${ageLabel(generatedAt - index.indexedAt)} · rechecking`
      : index.state === 'failed'
        ? 'Index failed'
        : `Updated ${ageLabel(generatedAt - index.indexedAt)}`;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 pt-2 text-center text-[10px] text-ink/40">
      <span>
        {status} · {index.transcripts.toLocaleString('en-US')} transcripts ·{' '}
        {index.records.toLocaleString('en-US')} records · {providers}{' '}
        {providers === 1 ? 'provider' : 'providers'}
      </span>
      <span aria-hidden="true">·</span>
      <span>index scan {index.scanMs.toLocaleString('en-US')} ms</span>
      {index.state === 'failed' && index.error && (
        <>
          <span aria-hidden="true">·</span>
          <span className="text-[var(--theme-error)]">{index.error}</span>
        </>
      )}
    </div>
  );
}
