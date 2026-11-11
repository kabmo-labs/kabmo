/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The panel's header: what it is, then the scope, then the filter.
 *
 * The panel is 320–560px wide, so the header is three rows and each row is one
 * idea:
 *
 * - the TITLE row names the panel and carries the refresh and the credential,
 *   which act on the whole read;
 * - the SCOPE row is the shared repo picker, the provider chip and the link out;
 * - the FILTER row is the state segment, "assigned to me", the search field and
 *   the label disclosure.
 *
 * **Search is a field, not a hidden mode.** Finding an issue by its text is the
 * most common thing a reader does here, and it used to sit behind a funnel icon
 * that also held the label filter. The two are separate now: the search field is
 * always visible, and the label filter is the one that folds away.
 *
 * **Releases carry no filter row.** No host filters a release collection by
 * state, assignee, label or text, so drawing those controls over it would be a
 * row of switches that change nothing. The row is replaced by the one fact that
 * is true: releases are listed newest first.
 *
 * The provider chip is not decoration: a self-hosted host is routinely GitLab
 * while the reader assumes GitHub, and the vocabulary in the sidebar (MRs vs
 * PRs) is derived from the same fact.
 *
 * `showHeader` is the host's own flag: the phone's drawer draws its own tab strip
 * above the view, so a title row here would name the same panel twice. The scope
 * row stays, because it holds controls rather than a name.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { RepoPicker, type RepoScopeHandle } from '@kabmo-labs/kabmo-ui';

import {
  DEFAULT_FILTER,
  filterIsDefault,
  type ForgeCredential,
  type ForgeFilter,
  type ForgeList,
  type ForgeProvider,
  type ForgeSection,
  type ForgeState,
} from '../protocol';
import { CredentialSheet } from './Credential';
import { Glyph, ICON } from './Glyph';
import { providerLabel } from './format';
import type { Scope } from './use-forge';

interface HeaderProps {
  scope: RepoScopeHandle;
  showHeader: boolean;
  section: ForgeSection;
  list: ForgeList | null;
  provider: ForgeProvider;
  filter: ForgeFilter;
  loading: boolean;
  credential: ForgeCredential | null;
  /** The same scope the reads use, so the sheet's probe asks about this repo. */
  target: Scope | null;
  onFilter: (next: ForgeFilter) => void;
  onRefresh: () => void;
}

/**
 * How long a typed filter waits before it is read.
 *
 * A filter is applied by the HOST, so every keystroke would otherwise be one
 * request — and on GitHub's search endpoint, one request against a 30/minute
 * budget. The pause is the reader's own: nobody types a label and expects the
 * list to move mid-word.
 */
const TYPE_DELAY_MS = 400;

const STATES: Array<{ value: ForgeState; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];

/** The focus ring every control in this header shares. */
const CONTROL = 'tap-target cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20';

export function Header({
  scope,
  showHeader,
  section,
  list,
  provider,
  filter,
  loading,
  credential,
  target,
  onFilter,
  onRefresh,
}: HeaderProps) {
  const [expanded, setExpanded] = useState(false);
  const [credentialOpen, setCredentialOpen] = useState(false);
  const narrowed = !filterIsDefault(filter);
  const filterable = section !== 'releases';
  // Bitbucket's list endpoints take no assignee filter, so a "Mine" toggle there
  // would be a control that changes nothing. The server ignores the field; the
  // panel must not offer it.
  const canMine = provider !== 'bitbucket';

  // The two typed fields keep their own draft, committed after a pause. A
  // controlled input bound straight to the committed filter would move the
  // caret on every re-render the read causes.
  const [label, setLabel] = useState(filter.label);
  const [query, setQuery] = useState(filter.query);
  const onFilterRef = useRef(onFilter);
  onFilterRef.current = onFilter;
  const latest = useRef({ label, query });
  latest.current = { label, query };

  // Follow a filter changed from elsewhere (a repo switch resets it, a Clear
  // empties it) — but not the reader's own typing, which is already the draft.
  useEffect(() => {
    setLabel(filter.label);
    setQuery(filter.query);
  }, [filter.label, filter.query]);

  useEffect(() => {
    if (label === filter.label && query === filter.query) return;
    const timer = setTimeout(() => {
      onFilterRef.current({ ...filter, label: latest.current.label, query: latest.current.query });
    }, TYPE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [label, query, filter.state, filter.mine]);

  const refresh = (
    <button
      type="button"
      onClick={onRefresh}
      disabled={loading}
      title="Re-read from the host"
      aria-label="Re-read from the host"
      className={`flex-shrink-0 cursor-pointer rounded p-1 text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink disabled:cursor-default disabled:opacity-50 ${CONTROL}`}
    >
      <span className={loading ? 'inline-flex animate-spin' : 'inline-flex'}>
        <Glyph path={ICON.refresh} size={13} />
      </span>
    </button>
  );

  const credentialButton = (
    <button
      type="button"
      onClick={() => setCredentialOpen((value) => !value)}
      aria-expanded={credentialOpen}
      title={
        credential?.present
          ? `Credential: ${credential.source}. Open for details.`
          : 'No credential: public repositories only. Open for details.'
      }
      aria-label="Credential details"
      className={`flex-shrink-0 cursor-pointer rounded p-1 transition-colors hover:bg-ink/5 ${CONTROL} ${
        credential?.present ? 'text-success-text' : 'text-warning-text'
      }`}
    >
      <Glyph path={ICON.key} size={12} />
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
          <div className="flex items-center gap-0.5">
            {refresh}
            {credentialButton}
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5 px-2 pt-1.5">
        <RepoPicker scope={scope} className="min-w-0" />
        {list && (
          <span
            className="flex-shrink-0 rounded border border-ink/15 bg-ink/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink/60"
            title={`${list.host}/${list.slug}`}
          >
            {providerLabel(provider)}
          </span>
        )}
        {list && (
          <a
            href={list.webUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the repository on its host"
            aria-label="Open the repository on its host"
            className={`flex-shrink-0 cursor-pointer rounded p-1 text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink ${CONTROL}`}
          >
            <Glyph path={ICON.external} size={13} />
          </a>
        )}
        {!showHeader && refresh}
        {!showHeader && credentialButton}
      </div>

      {filterable ? (
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <div className="flex flex-shrink-0 items-center rounded border border-ink/15 p-px" role="group" aria-label="State filter">
            {STATES.map((state) => (
              <button
                key={state.value}
                type="button"
                onClick={() => onFilter({ ...filter, state: state.value })}
                aria-pressed={filter.state === state.value}
                className={`cursor-pointer rounded-sm px-1.5 py-0.5 text-[10px] transition-colors ${CONTROL} ${
                  filter.state === state.value ? 'bg-ink/10 font-medium text-ink' : 'text-ink/60 hover:text-ink'
                }`}
              >
                {state.label}
              </button>
            ))}
          </div>

          {canMine && (
            <button
              type="button"
              onClick={() => onFilter({ ...filter, mine: !filter.mine })}
              aria-pressed={filter.mine}
              title="Only items assigned to me"
              className={`flex-shrink-0 cursor-pointer rounded border px-1.5 py-0.5 text-[10px] transition-colors ${CONTROL} ${
                filter.mine ? 'border-ink/30 bg-ink/10 font-medium text-ink' : 'border-ink/15 text-ink/60 hover:text-ink'
              }`}
            >
              Mine
            </button>
          )}

          <div className="flex min-w-0 flex-1 items-center gap-1 rounded border border-ink/15 bg-canvas px-1.5 py-1 focus-within:border-ink/40">
            <span className="flex-shrink-0 text-ink/40">
              <Glyph path={ICON.search} size={11} />
            </span>
            <input
              type="text"
              value={query}
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search"
              aria-label="Search titles and bodies"
              className="min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none placeholder-ink/40"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                title="Clear the search"
                aria-label="Clear the search"
                className={`flex-shrink-0 cursor-pointer rounded p-0.5 text-ink/50 hover:text-ink ${CONTROL}`}
              >
                <Glyph path={ICON.cross} size={10} />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            title="Label filter"
            aria-label="Label filter"
            className={`flex flex-shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors ${CONTROL} ${
              narrowed ? 'text-ink' : 'text-ink/60 hover:text-ink'
            }`}
          >
            <Glyph path={ICON.filter} size={11} />
            {narrowed && <span className="font-medium">filtered</span>}
          </button>
        </div>
      ) : (
        <div className="px-2 pb-1.5 text-[10px] text-ink/55">Newest first. Releases are not filtered.</div>
      )}

      {expanded && filterable && (
        <div className="flex flex-col gap-1 px-2 pb-1.5">
          <input
            type="text"
            value={label}
            onInput={(event) => setLabel(event.currentTarget.value)}
            placeholder="Label, exactly"
            aria-label="Label filter"
            className="w-full rounded border border-ink/15 bg-canvas px-1.5 py-1 text-[11px] text-ink outline-none placeholder-ink/40 focus:border-ink/40"
          />
          {narrowed && (
            <button
              type="button"
              onClick={() => {
                setLabel('');
                setQuery('');
                onFilter(DEFAULT_FILTER);
              }}
              className={`self-start cursor-pointer text-[10px] text-ink/60 underline underline-offset-2 hover:text-ink ${CONTROL}`}
            >
              Clear every filter
            </button>
          )}
        </div>
      )}

      {credentialOpen && (
        <div className="px-2 pb-1.5">
          <CredentialSheet scope={target} credential={credential} onClose={() => setCredentialOpen(false)} />
        </div>
      )}
    </div>
  );
}
