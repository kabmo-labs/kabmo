/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two import controls on a harness card: the background switch and the
 * manual "copy now" button.
 *
 * Split from the card because both actions share one result line and one busy
 * state, and the card had grown past the repo's file ceiling. The rules stay
 * here with the controls:
 *
 *  - the switch is OFF until the user turns it on — the background pass spawns
 *    the agent at boot and every quarter-hour, which is consent per harness;
 *  - both are disabled when the probe has not reported `list`, with the reason
 *    in the title, because a button that can only fail is worse than none;
 *  - a refusal is shown verbatim; a success names the counts.
 */

import { useState } from 'preact/hooks';
import { Loader2 } from 'lucide-preact';
import type { HarnessSessionImport, HarnessSummary } from '@/shared/types/harness';

interface HarnessImportControlsProps {
  summary: HarnessSummary;
  /** `null` when this harness has no probe: the capability is unknown. */
  listSessions: boolean | null;
  /** The card's own Check-status flight. */
  probing: boolean;
  /** The card's roster/config flight. */
  busy: boolean;
  onImportSessions?: (id: string) => Promise<{ result: HarnessSessionImport | null; error: string | null }>;
  onSetAutoImport?: (
    id: string,
    enabled: boolean,
  ) => Promise<{ autoImport: boolean | null; result: HarnessSessionImport | null; error: string | null }>;
}

function describeImport(result: HarnessSessionImport): string {
  return [
    `${result.imported} imported`,
    `${result.known} already listed`,
    ...(result.outside > 0 ? [`${result.outside} outside your workspaces`] : []),
  ].join(' · ');
}

export function HarnessImportControls({
  summary, listSessions, probing, busy, onImportSessions, onSetAutoImport,
}: HarnessImportControlsProps) {
  const [importing, setImporting] = useState(false);
  const [autoImportBusy, setAutoImportBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; problem: boolean } | null>(null);
  // The built-in transport has nothing to ask; omp (ACP) writes omp's own
  // session files, which the sidebar scan already lists.
  if (!(onImportSessions || onSetAutoImport) || summary.builtIn || summary.id === 'omp-acp') return null;
  const unavailable = listSessions !== true;

  const runImport = async () => {
    if (!onImportSessions) return;
    setImporting(true);
    setNote(null);
    try {
      const { result, error } = await onImportSessions(summary.id);
      setNote(result && !error
        ? { text: describeImport(result), problem: false }
        : { text: error ?? 'Import failed', problem: true });
    } finally {
      setImporting(false);
    }
  };

  const toggleAutoImport = async () => {
    if (!onSetAutoImport) return;
    setAutoImportBusy(true);
    setNote(null);
    try {
      const { result, error } = await onSetAutoImport(summary.id, summary.autoImport !== true);
      if (error) setNote({ text: error, problem: true });
      else if (result) setNote({ text: describeImport(result), problem: false });
    } finally {
      setAutoImportBusy(false);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-ink/10 pt-3">
      {onSetAutoImport && (
        // The switch ROLE stays on the TRACK, never on a button that also wraps
        // the label: `[data-icon-style="color"] [role="switch"][aria-checked]`
        // paints the element's background with success/error, and with the label
        // inside that element the green (or red) swallowed the words.
        <span className="inline-flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={summary.autoImport === true}
            aria-label={`Auto import ${summary.label} sessions`}
            onClick={() => void toggleAutoImport()}
            disabled={autoImportBusy || importing || probing || busy || unavailable}
            title={
              unavailable
                ? 'Check status first: this agent has not reported whether it lists sessions'
                : 'Import this agent\'s own sessions at boot and every 15 minutes'
            }
            className={`relative h-4 w-8 shrink-0 cursor-pointer rounded-full border-0 p-0 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              summary.autoImport === true ? 'bg-ink/70' : 'bg-ink/20'
            }`}
          >
            <span
              className={`absolute top-0.5 h-3 w-3 rounded-full bg-canvas transition-all ${
                summary.autoImport === true ? 'left-[18px]' : 'left-0.5'
              }`}
            />
          </button>
          <span className={`text-[11px] ${unavailable ? 'text-ink/40' : 'text-ink/70'}`}>Auto import</span>
        </span>
      )}
      {onImportSessions && (
        <button
          type="button"
          onClick={() => void runImport()}
          disabled={importing || autoImportBusy || probing || busy || unavailable}
          title={
            listSessions === null
              ? 'Check status first: this agent has not reported whether it lists sessions'
              : !listSessions
                ? 'This agent reports no session list'
                : 'Spawn this agent once and copy the chats it already holds'
          }
          className="cursor-pointer rounded-md border border-ink/20 px-2 py-1 text-[11px] text-ink/70 transition-colors hover:border-ink/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {importing ? <Loader2 size={12} className="animate-spin" /> : 'Import sessions'}
        </button>
      )}
      {note && (
        <span className={`text-[11px] ${note.problem ? 'text-error' : 'text-ink/55'}`}>{note.text}</span>
      )}
    </div>
  );
}
