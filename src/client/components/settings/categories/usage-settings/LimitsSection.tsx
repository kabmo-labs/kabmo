import type { UsageLimitWindow } from '@/shared/types';
import { formatDateTime, formatFractionPercent, formatUsageAmount } from '@/client/components/settings/categories/usage-settings/format';

interface LimitRowProps {
  limit: UsageLimitWindow;
}

/** One provider-reported quota window: label, bar, used/remaining, reset. */
function LimitRow({ limit }: LimitRowProps) {
  const percent = Math.min(100, Math.max(0, (limit.usedFraction ?? 0) * 100));
  const scope = limit.modelId ?? limit.accountId;
  const usedText = limit.used !== undefined ? formatUsageAmount(limit.used, limit.unit) : undefined;
  const limitText = limit.limit !== undefined ? formatUsageAmount(limit.limit, limit.unit) : undefined;
  const remainingText = limit.remaining !== undefined
    ? formatUsageAmount(limit.remaining, limit.unit)
    : undefined;

  return (
    <div className="bg-paper border border-ink/15 rounded-lg p-3 shadow-xs space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-ink truncate">{limit.label}</div>
          {scope && <div className="text-[10px] text-ink/50 truncate">{scope}</div>}
        </div>
        <span className="text-[10px] text-ink/50 flex-shrink-0 whitespace-nowrap">
          {limit.resetsAt !== undefined ? `Resets ${formatDateTime(new Date(limit.resetsAt).toISOString())}` : ''}
        </span>
      </div>

      <div className="h-1.5 w-full bg-ink/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${limit.status === 'exhausted' ? 'bg-error/70' : 'bg-ink/80'}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[10px] text-ink/60">
        <span>
          Used{' '}
          <span className="font-semibold text-ink">
            {limit.unit === 'percent' || !usedText ? formatFractionPercent(limit.usedFraction ?? 0) : usedText}
          </span>
          {/* A percent unit is already a share of 100, so naming the limit
              again would print "42% of 100%". */}
          {limit.unit !== 'percent' && usedText && limitText ? ` of ${limitText}` : ''}
        </span>
        <span className="flex items-center gap-2">
          {limit.status !== 'ok' && limit.status !== 'unknown' && (
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-ink/10 text-ink/70">
              {limit.status}
            </span>
          )}
          {remainingText && (
            <span>
              Remaining <span className="font-semibold text-ink">{remainingText}</span>
            </span>
          )}
        </span>
      </div>

      {limit.notes && limit.notes.length > 0 && (
        <ul className="text-[10px] text-ink/50 leading-relaxed space-y-0.5">
          {limit.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface LimitsSectionProps {
  limits: UsageLimitWindow[];
  /** Whether omp ships a usage adapter for this provider. */
  tracked: boolean;
  /** omp tracks this provider but its endpoint returned nothing. */
  unavailable?: boolean;
  /** Provider-wide caveats shown above the windows. */
  notes?: string[];
}

/** Generic quota windows for any provider omp reports usage for. */
export function LimitsSection({ limits, tracked, unavailable, notes }: LimitsSectionProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-ink/40">
        Quota windows
      </h4>

      {notes && notes.length > 0 && (
        <ul className="text-[10px] text-ink/50 leading-relaxed space-y-0.5">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {limits.length === 0 ? (
        <p className="text-[11px] text-ink/50">
          {!tracked
            ? 'No quota source for this provider: omp ships no usage adapter for it and it exposes no balance endpoint Kabmo knows.'
            : unavailable
              ? 'omp tracks this provider but its usage endpoint returned no data — an invalid or expired credential, an unreachable endpoint, or a plan without quota windows.'
              : 'No quota windows were reported for this provider.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {limits.map((limit) => (
            <LimitRow key={limit.id} limit={limit} />
          ))}
        </div>
      )}
    </div>
  );
}
