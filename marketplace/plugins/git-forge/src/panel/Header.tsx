/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The panel's header: what it is, then the scope, then the filter.
 *
 * Three rows' worth of information in two rows, because the panel is 320px wide
 * on a 1440px screen:
 *
 * - the TITLE row names the panel and carries the refresh, which acts on the
 *   whole read;
 * - the SCOPE row is the shared repo picker plus the provider badge, and the
 *   state filter — the only control that changes what the list contains.
 *
 * The provider badge is not decoration: a self-hosted host is routinely GitLab
 * while the reader assumes GitHub, and the vocabulary in the sidebar (MRs vs
 * PRs) is derived from the same fact. Showing it is what makes the vocabulary
 * explainable.
 *
 * `showHeader` is the host's own flag: the phone's drawer draws its own tab strip
 * above the view, so a title row here would name the same panel twice. The scope
 * row stays, because it holds controls rather than a name.
 */

import { RepoPicker, type RepoScopeHandle } from '@kabmo-labs/kabmo-ui';

import type { ForgeList, ForgeState } from '../protocol';
import { Glyph, ICON } from './Glyph';

interface HeaderProps {
  scope: RepoScopeHandle;
  showHeader: boolean;
  list: ForgeList | null;
  state: ForgeState;
  loading: boolean;
  onState: (state: ForgeState) => void;
  onRefresh: () => void;
}

const STATE_CHOICES: Array<{ value: ForgeState; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];

export function Header({ scope, showHeader, list, state, loading, onState, onRefresh }: HeaderProps) {
  const filter = (
    <div className="flex flex-shrink-0 items-center rounded border border-ink/15 p-px" role="group" aria-label="State filter">
      {STATE_CHOICES.map((choice) => (
        <button
          key={choice.value}
          type="button"
          onClick={() => onState(choice.value)}
          aria-pressed={state === choice.value}
          className={`px-1.5 py-0.5 text-[10px] transition-colors ${
            state === choice.value ? 'bg-ink/10 font-medium text-ink' : 'text-ink/55 hover:text-ink'
          }`}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );

  const refresh = (
    <button
      type="button"
      onClick={onRefresh}
      disabled={loading}
      title="Re-read from the host"
      aria-label="Re-read from the host"
      className="flex-shrink-0 rounded p-1 text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink disabled:opacity-50"
    >
      <Glyph path={ICON.refresh} size={13} />
    </button>
  );

  return (
    <div className="flex flex-shrink-0 flex-col border-b border-ink/10">
      {showHeader && (
        <div className="flex h-10 items-center justify-between gap-2 px-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <Glyph path={ICON.forge} size={14} />
            <span className="truncate text-xs font-semibold uppercase tracking-wider text-ink">Forge</span>
          </div>
          {refresh}
        </div>
      )}

      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <RepoPicker scope={scope} className="min-w-0" />
        {list && (
          <span
            className="flex-shrink-0 rounded border border-ink/15 bg-ink/5 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider text-ink/60"
            title={`${list.host}/${list.slug}`}
          >
            {list.provider}
          </span>
        )}
        {list && (
          <a
            href={list.webUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the repository on its host"
            aria-label="Open the repository on its host"
            className="flex-shrink-0 rounded p-1 text-ink/60 hover:bg-ink/5 hover:text-ink"
          >
            <Glyph path={ICON.external} size={13} />
          </a>
        )}
        {filter}
        {!showHeader && refresh}
      </div>
    </div>
  );
}
