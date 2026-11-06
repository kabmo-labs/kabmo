/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * All Harnesses: one ROW per agent, with the switch that decides whether it
 * exists anywhere else in the app.
 *
 * This page used to be twelve full cards — capabilities, config form, provider
 * panel — which made a roster question ("which agents do I run?") into a page
 * you scroll through. The switch is the only control that belongs here: turning
 * one on probes it once and its page appears in the menu, turning one off
 * removes it from the menu and from the composer's picker. What the agent can DO
 * is that agent's own page, reached from the row.
 *
 * A switched-off harness STAYS in this list, because it is the only place it can
 * be switched back on.
 */

import { AlertCircle, ArrowUpRight, Check, CircleDashed, Loader2, PackageX } from 'lucide-preact';
import { HarnessGlyph, HARNESS_GLYPH_SIZE } from '@/client/components/common/harness-glyph';
import { harnessStatus, type HarnessState } from '@/shared/lib/harness/status';
import type { HarnessSummary } from '@/shared/types/harness';

interface HarnessToggleListProps {
  /** Every non-built-in harness, switched on or off. */
  harnesses: HarnessSummary[];
  /** The harness a switch is in flight for, or null. */
  busy: string | null;
  onSetEnabled: (id: string, enabled: boolean) => void;
  /** Opens that harness's own settings page. */
  onOpen: (id: string) => void;
  onProbe: (id: string) => void;
}

/** The state's mark: shape carries the state, so tone is reinforcement only. */
function StatusMark({ state }: { state: HarnessState }) {
  if (state === 'ready') return <Check size={11} className="text-ink/70" />;
  if (state === 'not-installed') return <PackageX size={11} className="text-ink/50" />;
  if (state === 'needs-setup') return <AlertCircle size={11} className="text-ink/55" />;
  return <CircleDashed size={11} className="text-ink/35" />;
}

/** How a row says when it was last checked, or that it never was. */
function probedLabel(summary: HarnessSummary): string {
  const probe = summary.probe;
  if (!probe) return 'not probed';
  const minutes = Math.max(0, Math.round((Date.now() - probe.probedAt) / 60_000));
  const ago = minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
  // An aged record keeps its answer and gains its age — never "not probed", which
  // is what this page said before the record survived a restart.
  return probe.stale ? `checked ${ago} · re-check for a current version` : `checked ${ago}`;
}

export function HarnessToggleList({
  harnesses, busy, onSetEnabled, onOpen, onProbe,
}: HarnessToggleListProps) {
  return (
    <ul className="divide-y divide-ink/10 rounded-xl border border-ink/10 bg-paper">
      {harnesses.map((summary) => {
        const status = harnessStatus(summary);
        const checking = busy === summary.id;
        return (
          <li key={summary.id} className="flex items-center gap-3 px-3 py-2.5">
            <span className={summary.enabled ? '' : 'opacity-40'}>
              <HarnessGlyph harness={summary.id} size={HARNESS_GLYPH_SIZE.compact} />
            </span>

            <div className="min-w-0 flex-1">
              <div className={`truncate text-xs font-medium ${summary.enabled ? 'text-ink' : 'text-ink/45'}`}>
                {summary.label}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-ink/45">
                {/* The chip names WHICH state: a missing binary, an agent that
                    wants a login, an answer, or an absence of information. */}
                <span className="inline-flex items-center gap-1" title={status.detail ?? undefined}>
                  <StatusMark state={status.state} />
                  {status.label}
                </span>
                {summary.enabled && (
                  <span className="text-ink/35">
                    {summary.canLaunch ? probedLabel(summary) : status.detail}
                  </span>
                )}
              </div>
            </div>

            {/* Checking status is meaningless for a harness that is switched
                off, and for one whose binary is missing: both are disabled with
                the reason in the title. */}
            {summary.enabled && (
              <button
                type="button"
                disabled={checking || !summary.canLaunch}
                onClick={() => onProbe(summary.id)}
                title={summary.canLaunch ? 'Spawn this agent once and read what it reports' : status.detail ?? 'Not installed'}
                className="shrink-0 cursor-pointer rounded-md border border-ink/15 px-2 py-1 text-[10px] text-ink/60 transition-colors hover:border-ink/35 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                {checking ? <Loader2 size={10} className="animate-spin" /> : 'Check'}
              </button>
            )}

            {summary.enabled && (
              <button
                type="button"
                onClick={() => onOpen(summary.id)}
                title={`Open ${summary.label} settings`}
                aria-label={`Open ${summary.label} settings`}
                className="shrink-0 cursor-pointer rounded p-1 text-ink/40 transition-colors hover:text-ink"
              >
                <ArrowUpRight size={12} />
              </button>
            )}

            <button
              type="button"
              role="switch"
              aria-checked={summary.enabled}
              aria-label={`${summary.enabled ? 'Disable' : 'Enable'} ${summary.label}`}
              disabled={checking}
              onClick={() => onSetEnabled(summary.id, !summary.enabled)}
              title={
                summary.enabled
                  ? 'Turn off — hides its settings page and removes it from the model picker'
                  : 'Turn on — probes it once and adds its settings page'
              }
              className={`relative h-4 w-8 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                summary.enabled ? 'bg-ink/70' : 'bg-ink/20'
              }`}
            >
              {checking ? (
                <Loader2 size={9} className="absolute inset-0 m-auto animate-spin text-canvas" />
              ) : (
                <span
                  className={`absolute top-0.5 h-3 w-3 rounded-full bg-canvas transition-all ${
                    summary.enabled ? 'left-[18px]' : 'left-0.5'
                  }`}
                />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
