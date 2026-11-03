/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The OMP Engine panel's header: live state at a glance, plus the two controls
 * that belong to the snapshot (search and refresh).
 *
 * The snapshot used to be four static tiles that only changed on a full panel
 * reload, so a running engine reported whatever it held when the modal opened.
 * Refresh now owns its own busy state, the tiles carry the provider beside the
 * model and a context meter with its token counts, and the moment of the
 * reading is printed — a live-state panel that cannot say when it was read is
 * indistinguishable from a stale one.
 */

import type { ComponentChildren } from 'preact';
import { Loader2, RefreshCw, Search, X } from 'lucide-preact';
import { CONTEXT_BAND_TONES, clampContextPercent, contextUsageBand } from '@/shared/lib/chat/context/usage';
import { formatCompactTokens } from '@/shared/lib/format/number';
import type { EngineState } from '@/client/components/settings/categories/omp-settings/types';

interface EngineHeaderProps {
  running: boolean;
  state: EngineState | null;
  refreshing: boolean;
  updatedAt: number | null;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
}

/** `12:34:56`, the local read time of the snapshot. */
function readTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function EngineHeader({
  running,
  state,
  refreshing,
  updatedAt,
  searchQuery,
  onSearchChange,
  onRefresh,
}: EngineHeaderProps) {
  const percent = state?.contextUsage?.percent;
  const hasPercent = typeof percent === 'number' && Number.isFinite(percent);
  const clamped = hasPercent ? clampContextPercent(percent) : 0;
  const tone = CONTEXT_BAND_TONES[contextUsageBand(clamped)];
  const tokens = formatCompactTokens(state?.contextUsage?.tokens);
  const window = formatCompactTokens(state?.contextUsage?.contextWindow);
  const modelId = state?.model?.id;

  return (
    <div className="flex flex-col gap-3 pb-3 border-b border-ink/10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">OMP Engine</h2>
          <p className="text-ink/50 mt-0.5">
            Live agent state and the full native config schema from oh-my-pi.
            {updatedAt !== null && <span className="text-ink/40"> Read at {readTime(updatedAt)}.</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink/40 pointer-events-none" />
            <input
              aria-label="Search settings"
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.currentTarget.value)}
              placeholder="Search every setting…"
              className="w-52 bg-paper border border-ink/15 rounded-md pl-6 pr-6 py-1 text-ink placeholder:text-ink/40 focus:outline-none focus:border-ink/40"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => onSearchChange('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink cursor-pointer"
              >
                <X size={11} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-busy={refreshing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-ink/15 text-ink/70 hover:text-ink hover:bg-ink/5 transition-all cursor-pointer disabled:opacity-50"
          >
            {refreshing
              ? <Loader2 size={12} className="animate-spin" />
              : <RefreshCw size={12} />}
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Engine">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${running ? 'bg-success' : 'bg-ink/25'}`}
            />
            {running ? 'Running' : 'Idle'}
          </span>
        </Stat>
        <Stat label="Model">
          <span className="block truncate" title={modelId ? `${state?.model?.provider ?? ''} / ${modelId}` : undefined}>
            {modelId ?? '—'}
          </span>
          {state?.model?.provider && (
            <span className="block truncate text-[10px] font-normal text-ink/40">{state.model.provider}</span>
          )}
        </Stat>
        <Stat label="Thinking">
          <span className="capitalize">{state?.thinkingLevel ?? '—'}</span>
        </Stat>
        <Stat label="Context">
          <span className={hasPercent ? tone.text : undefined}>
            {hasPercent ? `${percent.toFixed(1)}%` : '—'}
          </span>
          {hasPercent && (
            <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-ink/10" aria-hidden="true">
              <span className={`block h-full rounded-full ${tone.fill}`} style={{ width: `${clamped}%` }} />
            </span>
          )}
          {tokens && (
            <span className="mt-0.5 block text-[10px] font-normal text-ink/40">
              {tokens}{window ? ` / ${window}` : ''} tokens
            </span>
          )}
        </Stat>
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-ink/40">{label}</div>
      <div className="font-semibold text-ink mt-0.5">{children}</div>
    </div>
  );
}
