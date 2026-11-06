/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness tab strip inside the model dropdown.
 *
 * A TAB, not a second control row: the composer's toolbar is full (model,
 * thinking, access, plan, goal, voice, send) and the harness changes WHAT THE
 * LIST IS, which is what a tab means. `Header.tsx` sits under it because the
 * search field then applies to whichever list the tab selected.
 *
 * Three rules the markup encodes:
 *
 *  - a harness that cannot run here is DISABLED, never hidden — hiding is what
 *    makes "why is Claude not there" unanswerable;
 *  - the reason is the agent's own words, in `title`, so the hover explains
 *    `mcode login` or `executable not found (command: pi)`;
 *  - the active tab is read-only for a live chat. Harness is a SPAWN property,
 *    so switching it must start a new session — the row says so instead of
 *    silently changing the frame source under a running transcript.
 */

import { HarnessGlyph, HARNESS_GLYPH_SIZE } from '@/client/components/common/harness-glyph';
import type { HarnessSummary } from '@/shared/types/harness';

interface HarnessTabsProps {
  harnesses: HarnessSummary[];
  /** The session's harness, or null for a chat that has not spawned yet. */
  active: string | null;
  /** False while a chat has messages: the choice would change the transcript's
   *  owner, which no frame source can do retroactively. */
  editable: boolean;
  onSelect: (harness: string) => void;
  /** Opens the settings page for a harness that needs install or login. */
  onFix?: (harness: string) => void;
}

/** Why a tab cannot be picked, in the agent's own words, or null when it can. */
export function harnessBlockedReason(summary: HarnessSummary): string | null {
  // A BUILT-IN transport is never blocked, whatever else the row says. `omp`
  // over RPC is the path this app IS: it has no agent to spawn and no launch
  // command, so a probe of it can only report "no launch command is configured"
  // — and that record used to paint a ⚠ over the DEFAULT tab and DISABLE it, so
  // the harness every session actually runs on could not be selected (measured).
  if (summary.builtIn) return null;
  if (!summary.canLaunch) return summary.unavailable ?? 'Not installed';
  const blocked = summary.probe?.capabilities.blocked;
  return blocked ?? null;
}

export function HarnessTabs({ harnesses, active, editable, onSelect, onFix }: HarnessTabsProps) {
  if (harnesses.length === 0) return null;
  return (
    <div
      // `flex-none` is load-bearing: the panel is a flex COLUMN with a measured
      // max height, so without it this strip was the first child to shrink and
      // collapsed to 5px — the tabs were in the DOM and painted 1px tall
      // (measured: `elementFromPoint` on the first tab answered the row BELOW
      // it). The list scrolls inside itself; the strip must not.
      className="flex-none flex items-stretch gap-0.5 overflow-x-auto border-b border-ink/10 bg-canvas/40 px-1 pt-1 scrollbar-overlay-container"
      role="tablist"
      aria-label="Harness"
    >
      {harnesses.map((summary) => {
        const blocked = harnessBlockedReason(summary);
        const isActive = summary.id === active;
        const disabled = Boolean(blocked) || !editable;
        return (
          <button
            key={summary.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-disabled={disabled}
            disabled={Boolean(blocked)}
            title={
              blocked
                ? `${summary.label}: ${blocked}${summary.install ? ` — install: ${summary.install}` : ''}`
                : !editable
                  ? `Start a new chat to use ${summary.label}`
                  : summary.probe
                    ? `${summary.label} · ${summary.probe.capabilities.agentName ?? ''} ${summary.probe.capabilities.agentVersion ?? ''}`.trim()
                    : summary.label
            }
            onClick={() => {
              if (blocked) {
                onFix?.(summary.id);
                return;
              }
              if (!editable) return;
              onSelect(summary.id);
            }}
            className={`tap-chip flex shrink-0 items-center gap-1.5 rounded-t px-2.5 py-1.5 text-xs transition-colors ${
              isActive
                ? 'bg-paper font-semibold text-ink shadow-[inset_0_-2px_0_0_currentColor]'
                : blocked
                  ? 'text-ink/35 cursor-not-allowed'
                  : editable
                    ? 'text-ink/65 hover:bg-ink/5 hover:text-ink cursor-pointer'
                    : 'text-ink/35 cursor-not-allowed'
            }`}
          >
            <HarnessGlyph harness={summary.id} size={HARNESS_GLYPH_SIZE.tab} />
            <span className="whitespace-nowrap">{summary.label}</span>
            {blocked && <span aria-hidden="true" className="text-[10px] text-ink/40">⚠</span>}
          </button>
        );
      })}
    </div>
  );
}
