/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The panel's header: what it is, then the scope, then the filter.
 *
 * The panel is 320–560px wide, so the filter is two rows and each row is one
 * idea:
 *
 * - the TITLE row names the panel and carries the refresh, which acts on the
 *   whole read;
 * - the SCOPE row is the shared repo picker, the provider badge and the state
 *   segment;
 * - the NARROW row is the two fields that take typing — "assigned to me" and the
 *   label/text pair — and it collapses behind a single control, because a panel
 *   that spends three rows on controls has no room for the list.
 *
 * The provider badge is not decoration: a self-hosted host is routinely GitLab
 * while the reader assumes GitHub, and the vocabulary in the sidebar (MRs vs
 * PRs) is derived from the same fact.
 *
 * `showHeader` is the host's own flag: the phone's drawer draws its own tab strip
 * above the view, so a title row here would name the same panel twice. The scope
 * row stays, because it holds controls rather than a name.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { RepoPicker, type RepoScopeHandle } from '@kabmo-labs/kabmo-ui';

import { filterIsDefault, type ForgeCredential, type ForgeFilter, type ForgeList, type ForgeState } from '../protocol';
import { CredentialSheet } from './Credential';
import { Glyph, ICON } from './Glyph';
import type { Scope } from './use-forge';

interface HeaderProps {
  scope: RepoScopeHandle;
  showHeader: boolean;
  list: ForgeList | null;
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

export function Header({ scope, showHeader, list, filter, loading, credential, target, onFilter, onRefresh }: HeaderProps) {
  const [expanded, setExpanded] = useState(false);
  const [credentialOpen, setCredentialOpen] = useState(false);
  const narrowed = !filterIsDefault(filter);

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
        {/*
          The credential indicator is a DOT rather than a sentence: a full token
          is present in the common case, and a row of prose about it would be the
          panel's first line. It is a button because the sheet behind it is where
          the two facts a reader needs live — which source, and whether it writes.
        */}
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
          className={`flex-shrink-0 rounded p-1 transition-colors hover:bg-ink/5 ${
            credential?.present ? 'text-success' : 'text-warning'
          }`}
        >
          <Glyph path={ICON.key} size={12} />
        </button>
        {!showHeader && refresh}
      </div>

      {credentialOpen && (
        <div className="px-2 pb-1.5">
          <CredentialSheet scope={target} credential={credential} onClose={() => setCredentialOpen(false)} />
        </div>
      )}

      <div className="flex items-center gap-1.5 px-2 pb-1.5">
        <div className="flex flex-shrink-0 items-center rounded border border-ink/15 p-px" role="group" aria-label="State filter">
          {STATES.map((state) => (
            <button
              key={state.value}
              type="button"
              onClick={() => onFilter({ ...filter, state: state.value })}
              aria-pressed={filter.state === state.value}
              className={`px-1.5 py-0.5 text-[10px] transition-colors ${
                filter.state === state.value ? 'bg-ink/10 font-medium text-ink' : 'text-ink/55 hover:text-ink'
              }`}
            >
              {state.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => onFilter({ ...filter, mine: !filter.mine })}
          aria-pressed={filter.mine}
          title="Only items assigned to me"
          className={`flex-shrink-0 rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
            filter.mine
              ? 'border-ink/30 bg-ink/10 font-medium text-ink'
              : 'border-ink/15 text-ink/55 hover:text-ink'
          }`}
        >
          Mine
        </button>

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          title="Label and text filters"
          aria-label="Label and text filters"
          className={`ml-auto flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors ${
            narrowed ? 'text-ink' : 'text-ink/55 hover:text-ink'
          }`}
        >
          <Glyph path={ICON.filter} size={11} />
          {narrowed && <span className="font-medium">filtered</span>}
        </button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-1 px-2 pb-1.5">
          <input
            type="text"
            value={label}
            onInput={(event) => setLabel(event.currentTarget.value)}
            placeholder="Label, exactly"
            aria-label="Label filter"
            className="w-full rounded border border-ink/15 bg-canvas px-1.5 py-1 text-[11px] text-ink outline-none placeholder-ink/35 focus:border-ink/40"
          />
          <input
            type="text"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder="Text in the title or body"
            aria-label="Text filter"
            className="w-full rounded border border-ink/15 bg-canvas px-1.5 py-1 text-[11px] text-ink outline-none placeholder-ink/35 focus:border-ink/40"
          />
          {narrowed && (
            <button
              type="button"
              onClick={() => {
                setLabel('');
                setQuery('');
                onFilter({ state: 'open', mine: false, label: '', query: '' });
              }}
              className="self-start text-[10px] text-ink/55 underline underline-offset-2 hover:text-ink"
            >
              Clear every filter
            </button>
          )}
        </div>
      )}
    </div>
  );
}
