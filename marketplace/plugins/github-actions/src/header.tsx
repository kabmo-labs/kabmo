/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The navbar readout: is this repository red, running, or green.
 *
 * It is a READOUT, not a control — the host wraps it in the button that opens
 * the panel (`opensPanel`), so nothing here is clickable or focusable. That split
 * is the header contract: a trigger renders what the entry READS, and the host
 * owns the interaction.
 *
 * The figures come from the plugin's realtime topic, which the SERVER fills while
 * at least one watcher is armed. This component is one of those watchers, and it
 * releases the watch while the document is hidden — a tab left open overnight
 * must not keep a 60-second conditional poll alive for a number nobody can see.
 *
 * `—` is the honest answer before the first snapshot, and it is also what a
 * repository with no GitHub remote gets: a header has no room for the sentence,
 * and the panel is one click away and says it in full.
 */

import { useEffect, useState } from 'preact/hooks';
import { useRealtime, useRepoScope, useRpc } from '@kabmo-labs/kabmo-ui';

import { RPC, repoKey, type ListInput, type Snapshots } from './protocol';

/** Whether this tab is being looked at. A visible-but-unfocused window still counts. */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const update = (): void => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

export function ActionsReadout() {
  const scope = useRepoScope();
  const root = scope.root ?? '';
  const repo = scope.repo || '.';
  const visible = useDocumentVisible();
  const realtime = useRealtime<Snapshots>();
  const watch = useRpc<ListInput, unknown>(RPC.watch);
  const unwatch = useRpc<ListInput, unknown>(RPC.unwatch);

  useEffect(() => {
    if (!root || !visible) return;
    const input: ListInput = { root, repo, filter: { branch: '', status: '' } };
    void watch.call(input);
    return () => {
      void unwatch.call(input);
    };
  }, [root, repo, visible]);

  const snapshot = realtime.value?.entries?.[repoKey(root, repo)] ?? null;
  const failing = snapshot?.failing ?? 0;
  const running = snapshot?.running ?? 0;

  const tone = failing > 0 ? 'text-error-text' : running > 0 ? 'text-warning-text' : 'text-ink/55';
  const text = !snapshot
    ? '—'
    : failing > 0
      ? `${failing} failing`
      : running > 0
        ? `${running} running`
        : snapshot.runs.length > 0
          ? 'CI ok'
          : 'no runs';

  return (
    <span class={`flex items-center gap-1 font-mono text-[10.5px] ${tone}`} title="GitHub Actions">
      <span aria-hidden="true">{failing > 0 ? '✕' : running > 0 ? '●' : snapshot ? '✓' : '–'}</span>
      <span>{text}</span>
    </span>
  );
}
