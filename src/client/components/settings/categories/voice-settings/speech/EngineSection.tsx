/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The speech engine cards. Five choices, each stating WHERE the text goes — the
 * one fact a user needs before clicking, and the one a label alone cannot carry.
 *
 * The local card carries a live capability line because it is the only engine
 * that can be present and broken at once: `omp say` arrived with omp 19, and an
 * older install answers "unknown command". Reporting that here keeps the
 * speaker button's failure from reading as "your speakers are broken".
 */

import { Check, CloudUpload, Cpu, RefreshCw, TriangleAlert } from 'lucide-preact';
import { TTS_ENGINES, type TtsEngine } from '@/shared/lib/tts/engines';
import type { TtsConfig } from '@/shared/lib/tts/settings';
import type { TtsLocalCapability } from '@/shared/lib/tts/capability';

export interface SpeechEngineSectionProps {
  config: TtsConfig;
  /** null while the probe is still running. */
  local: TtsLocalCapability | null | undefined;
  /** The ONNX addon's availability, for the card that needs it. */
  localRuntime: { available: boolean; reason?: string } | undefined;
  installedModels: number;
  busy: boolean;
  onSelect: (engine: TtsEngine) => void;
  onReprobe: () => void;
}

export function SpeechEngineSection({
  config,
  local,
  localRuntime,
  installedModels,
  busy,
  onSelect,
  onReprobe,
}: SpeechEngineSectionProps) {
  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Engine</h4>
        <p className="mt-0.5 text-[11px] text-ink/60">Where the answer's text is sent to be spoken.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TTS_ENGINES.map((engine) => {
          const selected = config.engine === engine.id;
          const Icon = engine.id === 'omp' || engine.id === 'local' ? Cpu : CloudUpload;
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
                    <div className={`flex h-7 w-7 items-center justify-center rounded-md ${selected ? 'bg-ink text-paper' : 'bg-ink/5 text-ink/70'}`}>
                      <Icon size={15} />
                    </div>
                    <span className="text-xs font-semibold text-ink">{engine.label}</span>
                  </div>
                  {selected
                    ? <Check size={14} className="text-success" />
                    : engine.needsKey && (
                      <span className="rounded bg-ink/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-ink/70">Key</span>
                    )}
                </div>
                <p className="text-[11px] leading-relaxed text-ink/70">{engine.where}</p>
              </div>

              {engine.id === 'omp' && (
                <div className="mt-2 flex items-start gap-1.5 text-[10px] leading-snug">
                  {unavailable ? (
                    <>
                      <TriangleAlert size={12} className="mt-px flex-shrink-0 text-error" />
                      <span className="text-error">{local?.reason ?? 'The local engine is unavailable.'}</span>
                    </>
                  ) : (
                    <span className="text-ink/50">
                      {local === null || local === undefined
                        ? 'Checking the local engine…'
                        : 'omp can run local speech on this machine.'}
                    </span>
                  )}
                </div>
              )}

              {engine.id === 'local' && (
                <div className="mt-2 flex items-start gap-1.5 text-[10px] leading-snug">
                  {localRuntime && !localRuntime.available ? (
                    <>
                      <TriangleAlert size={12} className="mt-px flex-shrink-0 text-error" />
                      <span className="text-error">{localRuntime.reason ?? 'The ONNX runtime is unavailable.'}</span>
                    </>
                  ) : (
                    <span className="text-ink/50">
                      {localRuntime === undefined
                        ? 'Checking the ONNX runtime…'
                        : installedModels === 0
                          ? 'No model installed yet — download one below.'
                          : `${installedModels} model${installedModels === 1 ? '' : 's'} installed on this machine.`}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {config.engine === 'omp' && local !== undefined && local !== null && !local.available && (
        <button
          type="button"
          disabled={busy}
          onClick={onReprobe}
          className="inline-flex items-center gap-1.5 rounded-md border border-ink/15 px-2 py-1 text-[11px] text-ink/70 transition-colors hover:border-ink/30 hover:text-ink disabled:opacity-50"
        >
          <RefreshCw size={11} className={busy ? 'animate-spin' : undefined} />
          Check again
        </button>
      )}
    </section>
  );
}
