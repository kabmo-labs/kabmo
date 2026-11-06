/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One harness's card: its mark, its live status, and the capabilities it
 * actually advertised.
 *
 * The capability rows are rendered FROM the probe, never from a hardcoded
 * table: the matrix in the design doc is the expected output of this card, so a
 * version bump that adds `fork` shows up here with no code change, and a harness
 * that has never been probed says so instead of borrowing omp's answers.
 *
 * "Check status" spawns the agent ONCE (measured: 0.08 s for omp, 2.3 s for
 * opencode) and caches the result, which is why it is a button rather than
 * something this page does on open.
 */

import { useState } from 'preact/hooks';
import { AlertCircle, Check, CircleDashed, Loader2, PackageX, X } from 'lucide-preact';
import { HarnessGlyph } from '@/client/components/common/harness-glyph';
import { harnessStatus, type HarnessState } from '@/shared/lib/harness/status';
import { HarnessConfigForm } from '@/client/components/settings/categories/harness-settings/ConfigForm';
import { EMPTY_HARNESS_CONFIG, type HarnessConfig } from '@/shared/lib/harness/config';
import { HarnessProviderPanel } from '@/client/components/settings/categories/harness-settings/ProviderPanel';
import type { HarnessProviderSupport } from '@/shared/types/harness';
import type { HarnessSummary } from '@/shared/types/harness';

interface HarnessCardProps {
  summary: HarnessSummary;
  onProbe: (id: string) => Promise<string | null>;
  install?: string;
  /** The stored per-harness config, or empty when the user never saved one. */
  config?: HarnessConfig;
  /** Save this harness's config; resolves to the server's refusal, or null. */
  onSaveConfig?: (id: string, config: HarnessConfig) => Promise<string | null>;
  /** Providers for this harness, at the level it actually supports. */
  providerSupport?: HarnessProviderSupport;
  /** Copy one provider from a source registry into this harness. */
  onImportProvider?: (
    id: string,
    sourceId: string,
    entry: HarnessProviderSupport['importable'][number],
  ) => Promise<string | null>;
}

/** One capability row: a label and a yes/no/never-probed answer. */
function Capability({ label, value, detail }: { label: string; value: boolean | null; detail?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-ink/5 py-1.5 last:border-0">
      <div className="min-w-0">
        <div className="text-ink/70">{label}</div>
        {detail && <div className="truncate text-[10px] text-ink/40" title={detail}>{detail}</div>}
      </div>
      <span className="shrink-0 font-mono text-[11px]">
        {value === null ? (
          <span className="text-ink/35">—</span>
        ) : value ? (
          <span className="inline-flex items-center gap-1 text-ink/80"><Check size={11} /> yes</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-ink/40"><X size={11} /> no</span>
        )}
      </span>
    </div>
  );
}

export function HarnessCard({
  summary, onProbe, install, config, onSaveConfig, providerSupport, onImportProvider,
}: HarnessCardProps) {
  const [probing, setProbing] = useState(false);
  const [problem, setProblem] = useState<string | null>(summary.probe?.capabilities.blocked ?? null);
  const caps = summary.probe?.capabilities;
  // ONE derivation, shared with the tests: the header chip, the sentence under it
  // and the action that fixes it all read the same state. `problem` is folded in
  // as the probe's live refusal, so pressing Check status updates the SAME path
  // a shipped refusal travels — a second branch here is how one card came to say
  // "ready" beside a banner quoting an error.
  const status = harnessStatus(
    problem ? { ...summary, probe: summary.probe && {
      ...summary.probe,
      capabilities: { ...summary.probe.capabilities, blocked: problem },
    } } : summary,
  );
  const blocked = status.state !== 'ready' && status.state !== 'unprobed';

  const check = async () => {
    setProbing(true);
    try {
      const reason = await onProbe(summary.id);
      setProblem(reason);
    } finally {
      setProbing(false);
    }
  };

  return (
    <section className="rounded-xl border border-ink/10 bg-paper">
      <header className="flex items-center justify-between gap-3 border-b border-ink/10 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <HarnessGlyph harness={summary.id} size={18} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink">{summary.label}</div>
            <div className="text-[11px] text-ink/45">
              {summary.transport === 'rpc' ? 'Native RPC (always available)' : 'ACP over stdio'}
              {caps?.agentVersion ? ` · ${caps.agentVersion}` : ''}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* The chip says WHICH state: `not installed`, `needs setup`, `ready`,
              `not probed`, `built in`. A single word `blocked` covered four
              different fixes, so it told the reader nothing to act on. */}
          <span
            className="inline-flex items-center gap-1 text-[11px] text-ink/60"
            title={status.detail ?? undefined}
          >
            <StatusMark state={status.state} />
            {status.label}
          </span>
          <button
            type="button"
            onClick={() => void check()}
            // A built-in transport has no agent to ask, and a missing binary has
            // nothing to answer: the button is disabled with the REASON in its
            // title, never silently inert.
            disabled={probing || !summary.canLaunch || summary.builtIn}
            title={
              summary.builtIn
                ? 'Nothing to probe: Kabmo runs this transport itself'
                : !summary.canLaunch
                  ? status.detail ?? 'Not installed'
                  : 'Spawn this harness once and read what it reports'
            }
            className="cursor-pointer rounded-md border border-ink/20 px-2 py-1 text-[11px] text-ink/70 transition-colors hover:border-ink/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {probing ? <Loader2 size={12} className="animate-spin" /> : 'Check status'}
          </button>
        </div>
      </header>

      <div className="px-4 py-3 text-xs">
        {/* The concrete sentence, always — never a bare state word. */}
        <div
          className={`mb-3 rounded-lg border p-2.5 text-[11px] ${
            blocked ? 'border-ink/15 bg-ink/[0.04] text-ink/75' : 'border-ink/10 bg-ink/[0.02] text-ink/55'
          }`}
        >
          <div className={blocked ? 'font-medium text-ink' : ''}>{status.detail}</div>
          {/* The install line belongs to a missing binary only: telling a signed-out
              agent to install a package it already has is a wrong instruction. */}
          {status.state === 'not-installed' && install && (
            <div className="mt-1 font-mono text-[10px] text-ink/50">{install}</div>
          )}
        </div>
        {summary.note && <p className="mb-3 text-[11px] leading-relaxed text-ink/45">{summary.note}</p>}

        <div className="grid gap-x-6 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink/40">Session</div>
            <Capability label="Load / resume history" value={caps ? caps.loadSession : null} />
            <Capability label="List sessions" value={caps ? caps.listSessions : null} />
            <Capability label="Fork" value={caps ? caps.forkSession : null} />
            <Capability label="Delete" value={caps ? caps.deleteSession : null} />
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink/40">Composer</div>
            <Capability
              label="Models offered"
              value={caps ? caps.configModel > 0 : null}
              detail={caps && caps.configModel > 0 ? `${caps.configModel} entries` : undefined}
            />
            <Capability
              label="Thinking levels"
              value={caps ? caps.configThinking > 0 : null}
              detail={caps && caps.configThinking > 0 ? `${caps.configThinking} levels` : undefined}
            />
            <Capability
              label="Mode selector"
              value={caps ? caps.configMode > 0 : null}
              detail={caps && caps.modeValues.length > 0 ? caps.modeValues.join(' · ') : undefined}
            />
            <Capability
              label="Mid-turn steering"
              value={caps ? caps.steerMode !== null : null}
              detail={caps?.steerMode === 'follow-up' ? 'queue only' : undefined}
            />
          </div>
        </div>

        {/* The config form is per-harness and only for a launchable one: a
            built-in transport has nothing to launch, and an uninstalled harness
            still benefits from a command override. */}
        {onSaveConfig && !summary.builtIn && (
          <HarnessConfigForm
            summary={summary}
            config={config ?? { ...EMPTY_HARNESS_CONFIG }}
            onSave={(next) => onSaveConfig(summary.id, next)}
          />
        )}

        {/* Providers, drawn at the level the harness supports. An env-style
            harness saves into the SAME config form's env block, so the two
            surfaces cannot disagree about what the spawn reads. */}
        {providerSupport && !summary.builtIn && (
          <HarnessProviderPanel
            support={providerSupport}
            {...(onSaveConfig
              ? { onSaveEnv: (env: string) => onSaveConfig(summary.id, { ...(config ?? EMPTY_HARNESS_CONFIG), env }) }
              : {})}
            {...(onImportProvider
              ? { onImport: (sourceId: string, entry: HarnessProviderSupport['importable'][number]) => onImportProvider(summary.id, sourceId, entry) }
              : {})}
          />
        )}

        <div className="mt-1 grid gap-x-6 sm:grid-cols-2">
          <Capability
            label="Usage / cost reported"
            value={caps ? caps.hasUsage : null}
            detail={caps && !caps.hasUsage ? 'usage panel shows “not reported”' : undefined}
          />
          <Capability label="Plan updates" value={caps ? caps.hasPlan : null} />
        </div>
      </div>
    </section>
  );
}

/**
 * The state's mark. Shape, not only colour: a reader who cannot separate two
 * low-contrast tones still sees a filled dot, a package with a slash, a warning
 * triangle or an empty ring.
 */
function StatusMark({ state }: { state: HarnessState }) {
  if (state === 'ready') return <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />;
  if (state === 'not-installed') return <PackageX size={12} className="text-ink/55" />;
  if (state === 'needs-setup') return <AlertCircle size={12} className="text-ink/60" />;
  return <CircleDashed size={12} className="text-ink/40" />;
}
