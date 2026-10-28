/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The navbar readout: how much is waiting on the reader.
 *
 * Two numbers, and the whole design is in what it does NOT do:
 *
 * - **It reads slowly.** Five minutes, not on every render: the counts come from
 *   the host's search endpoint, whose budget is 30 requests a minute, and a
 *   readout nobody is looking at must not spend it.
 * - **It reads nothing without a credential.** An anonymous read has no
 *   authenticated user, so "assigned to me" is not a question the host can
 *   answer — measured: GitHub answers `assignee:@me` with a total of 0, which
 *   would draw a confident zero over an unanswerable question.
 * - **It says `—` when a count could not be read**, and never `0`.
 *
 * The trigger OPENS the panel (`opensPanel: 'rightPanel'`), so the readout is the
 * way back to the list it counts.
 */

import { useEffect, useState } from 'preact/hooks';
import { usePanelInfo, useRepoScope, useRpc } from '@kabmo-labs/kabmo-ui';

import { RPC, type ForgeCounts } from './protocol';

/** How often the counts are re-read while the page is open. */
const REFRESH_MS = 5 * 60 * 1000;

/** One count, or a dash when it could not be read. */
function Count({ value, label }: { value: number | null; label: string }) {
  return (
    <span className="flex items-baseline gap-0.5">
      <span className="font-mono">{value === null ? '—' : value}</span>
      <span className="text-ink/50">{label}</span>
    </span>
  );
}

export function ForgeReadout() {
  const repo = useRepoScope();
  const info = usePanelInfo();
  const call = useRpc<{ root: string; repo: string }, ForgeCounts>(RPC.counts);
  const [counts, setCounts] = useState<ForgeCounts | null>(null);

  const root = repo.root;
  const target = repo.repo;

  useEffect(() => {
    if (!root) {
      setCounts(null);
      return;
    }
    let cancelled = false;
    const read = () => {
      void call.call({ root, repo: target }).then((outcome) => {
        if (cancelled || !outcome.ok) return;
        setCounts(outcome.value as ForgeCounts);
      });
    };
    read();
    const timer = setInterval(read, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // `call.call` is a new function per render, so it is deliberately not a
    // dependency: the pair below is the real trigger (the command-runner measured
    // the loop this avoids).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, target, info.sessionId]);

  if (!root) return <span className="text-ink/40">Forge</span>;
  if (!counts) return <span className="text-ink/40">Forge</span>;

  const title = counts.note ?? `${counts.host} · open items assigned to you`;

  return (
    <span className="flex items-center gap-1.5 text-[11px] text-ink/75" title={title}>
      <Count value={counts.issues} label="issues" />
      <span className="text-ink/25">·</span>
      <Count value={counts.pulls} label="PRs" />
    </span>
  );
}
