/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The engine cards. Four choices, each stating WHERE the audio goes — the one
 * fact a user needs before clicking, and the one a label alone cannot carry.
 *
 * The local card carries a live capability line because it is the only engine
 * that can be present and broken at once: omp's worker changed transport in 19.1
 * and this build's client no longer speaks it. Reporting that here is what keeps
 * the composer's failure from reading as "your microphone is broken".
 */

import { Check, CloudUpload, Cpu, RefreshCw, TriangleAlert } from 'lucide-preact';
import {
  DICTATION_ENGINES,
  type DictationEngine,
} from '@/shared/lib/dictation/engines';
import type { DictationConfig } from '@/shared/lib/dictation/settings';
import type { LocalDictationCapability } from '@/shared/lib/dictation/capability';

export interface EngineSectionProps {
  config: DictationConfig;
  /** null while the probe is still running. */
  local: LocalDictationCapability | null | undefined;
  busy: boolean;
  onSelect: (engine: DictationEngine) => void;
  onReprobe: () => void;
}

export function EngineSection({ config, local, busy, onSelect, onReprobe }: EngineSectionProps) {
  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Engine</h4>
        <p className="mt-0.5 text-[11px] text-ink/60">Where the microphone audio is transcribed.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {DICTATION_ENGINES.map((engine) => {
          const selected = config.engine === engine.id;
          const Icon = engine.id === 'omp' ? Cpu : CloudUpload;
          const unavailable = engine.id === 'omp' && local !== undefined && local !== null && !local.available;
          return (
            <div
              key={engine.id}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              onClick={() => onSelect(engine.id)}
              onKeyDown={(event) => event.key === 'Enter' && onSelect(engine.id)}
              className={`flex cursor-pointer select-none flex-col justify-between rounded-lg border p-3.5 text-left transition-all ${
                selected
                  ? 'border-ink bg-ink/5 ring-1 ring-ink/20'
                  : 'border-ink/15 bg-paper hover:border-ink/30 hover:bg-ink/[0.02]'
              }`}
            >
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`flex h-7 w-7 items-center justify-center rounded-md ${
                        selected ? 'bg-ink text-paper' : 'bg-ink/5 text-ink/70'
                      }`}
                    >
                      <Icon size={15} />
                    </div>
                    <span className="text-xs font-semibold text-ink">{engine.label}</span>
                  </div>
                  {engine.needsKey && (
                    <span className="rounded bg-ink/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-ink/70">
                      Key
                    </span>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed text-ink/70">{engine.where}</p>
              </div>

              <div className="mt-3 flex items-start justify-between gap-2 border-t border-ink/10 pt-2.5 text-[11px]">
                {unavailable ? (
                  <span className="flex items-start gap-1 text-ink/60">
                    <TriangleAlert size={11} className="mt-0.5 shrink-0" />
                    <span>Unavailable: the local worker did not start.</span>
                  </span>
                ) : (
                  <span className="text-ink/50">
                    {engine.id === 'omp'
                      ? local?.available
                        ? 'Local worker is running'
                        : 'Checked when the page opens'
                      : `Default model: ${engine.defaultModel}`}
                  </span>
                )}
                {selected && (
                  <span className="flex shrink-0 items-center gap-1 font-medium text-ink">
                    <Check size={12} /> Active
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {local && !local.available && local.reason && (
        <div className="rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2">
          <p className="text-[11px] leading-relaxed text-ink/70">{local.reason}</p>
          <button
            type="button"
            disabled={busy}
            onClick={onReprobe}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-ink/20 px-2 py-1 text-[11px] font-medium text-ink transition-colors hover:bg-ink/5 disabled:opacity-40"
          >
            <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
            Check again
          </button>
        </div>
      )}
    </section>
  );
}
