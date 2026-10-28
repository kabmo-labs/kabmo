/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Right-panel Forge: a repository's issues, requests and releases.
 *
 * ## The shape is the wiki panel's, deliberately
 *
 * A section list beside the thing it selects, and the selection persisted with
 * the scope it was made in — because the two panels answer the same question
 * ("what is in this repository, on its host?") and a reader who has used one
 * should not have to learn the other. The differences are the ones the subject
 * demands: three sections rather than a page tree, a filter, and a third level
 * (list → item) inside the content column.
 *
 * ## The repository is the SHARED pick
 *
 * `useRepoScope()` is the same selection the Files, Search, Source Control,
 * Terminal, Wiki and Commands panels use, so switching repos in any of them moves
 * this panel too. Reading a forge is a property of the checkout, and a private
 * pick would let the panel describe a repository the rest of the window is not
 * looking at.
 *
 * ## A pick is stored WITH its scope
 *
 * A section and an item id from another repository name nothing here — issue 12
 * of the previous project is a different issue — so the stored pick is used only
 * while its scope still matches, exactly as the wiki's page pick is. The FILTER
 * is stored with the scope for the same reason and one more: `state: closed`
 * carried into another repository is a filter the reader did not set there.
 *
 * ## Layout follows the wiki panel's, with one deliberate difference
 *
 * The section list sits on the trailing edge at a wide container
 * (`flex-row-reverse`, so the content keeps the panel's leading edge) and becomes
 * a horizontal STRIP above the content at a narrow one. The breakpoint is a
 * CONTAINER query, not a viewport one: the panel is 320–560px wide on any screen,
 * so a `sm:` rule would be decided by the window while the panel is what runs out
 * of room.
 *
 * The wiki hides its nav behind a drill; this panel keeps the switch visible,
 * because a forge reader moves between sections constantly — a pull request that
 * closes an issue is two sections apart. Only the ITEM is a drill: it replaces
 * the list with a back control, and the sections stay on screen.
 */

import { useEffect, useMemo } from 'preact/hooks';
import { usePanelHost, useRepoScope, useSessionState } from '@kabmo-labs/kabmo-ui';

import { DEFAULT_FILTER, type ForgeFilter, type ForgeItem, type ForgeSection } from '../protocol';
import { Header } from './Header';
import { ItemList } from './List';
import { ItemView } from './ItemView';
import { Sidebar } from './Sidebar';
import { useForgeCredential, useForgeDetail, useForgeList, useForgeWrite } from './use-forge';

interface ForgePanelProps {
  sessionId: string | null;
  workspacePath: string | null;
}

/** A selected item, kept next to the scope and section it belongs to. */
interface ForgePick {
  scope: string;
  section: ForgeSection;
  id: string;
}

const SECTIONS: readonly ForgeSection[] = ['issues', 'pulls', 'releases'];

/** The key a pick is validated against: root and repo, in one string. */
function scopeKeyOf(root: string | null, repo: string): string {
  return `${root ?? ''}\u0000${repo}`;
}

export function ForgePanel(_props: ForgePanelProps) {
  const host = usePanelHost();
  const enabled = host.enabled;
  const active = host.active;
  const repo = useRepoScope();
  const scope = repo.root ? { root: repo.root, repo: repo.repo } : null;
  const scopeKey = scopeKeyOf(repo.root, repo.repo);

  const [section, setSection] = useSessionState<ForgeSection>('forge.section', 'issues');
  // `DEFAULT_FILTER` is the same OBJECT every render: the hook's setters are
  // memoized over their fallback, so a factory here would re-arm the reset effect
  // below on every render and the panel would never settle.
  const [filter, setFilter] = useSessionState<ForgeFilter>('forge.filter', DEFAULT_FILTER);
  const [pick, setPick] = useSessionState<ForgePick | null>('forge.selected', null);

  const list = useForgeList(scope, filter, active);
  const credential = useForgeCredential(scope, active);
  const selected = pick && pick.scope === scopeKey && pick.section === section ? pick : null;
  const detail = useForgeDetail(scope, section, selected?.id ?? null, active);
  const write = useForgeWrite(scope, section, selected?.id ?? null, detail.reload);

  const provider = list.list?.provider ?? 'github';
  const items = list.list?.sections[section]?.items ?? [];
  const item = useMemo<ForgeItem | null>(
    () => (selected ? (items.find((entry) => entry.id === selected.id) ?? null) : null),
    [items, selected?.id],
  );

  // A repo switch is a different repository: drop the open item AND the filter,
  // so the panel lands on the new repository's own open issues rather than on a
  // filter that named the previous one.
  useEffect(() => {
    setPick((current) => (current && current.scope !== scopeKey ? null : current));
    setFilter(DEFAULT_FILTER);
  }, [scopeKey, setPick, setFilter]);

  // An item that is no longer in the list it was opened from — the filter moved,
  // or the host closed it — cannot be shown, so the list is what remains.
  useEffect(() => {
    if (selected && !item && items.length > 0) setPick(null);
  }, [selected, item, items.length, setPick]);

  const openSection = (next: ForgeSection) => {
    setSection(next);
    setPick(null);
  };

  const openItem = (entry: ForgeItem) => {
    setPick({ scope: scopeKey, section, id: entry.id });
  };

  // Same gate the other workspace-scoped views take: a forge hangs off a
  // repository, so with no workspace there is nothing to read and the panel must
  // say so rather than sit on a spinner no request will ever answer.
  if (!enabled) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-paper text-ink/40">
        <span className="text-xs font-mono">No session selected</span>
      </div>
    );
  }

  const showingDetail = Boolean(selected);

  return (
    <div className="@container flex h-full min-h-0 w-full flex-col bg-paper text-xs text-ink">
      <Header
        scope={repo}
        showHeader={host.showHeader !== false}
        list={list.list}
        filter={filter}
        loading={list.loading}
        onFilter={setFilter}
        onRefresh={() => void list.reload()}
      />

      <div className="flex min-h-0 flex-1 flex-col @[520px]:flex-row-reverse">
        <div className="flex-shrink-0 border-b border-ink/10 @[520px]:min-h-0 @[520px]:w-40 @[520px]:border-b-0 @[520px]:border-l">
          <Sidebar
            sections={SECTIONS}
            active={section}
            list={list.list}
            provider={provider}
            onSelect={openSection}
          />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {showingDetail && item ? (
            <ItemView
              item={item}
              detail={detail.detail}
              loading={detail.loading}
              error={detail.error}
              credential={credential}
              write={write}
              onBack={() => setPick(null)}
            />
          ) : (
            <ItemList
              list={list.list}
              provider={provider}
              section={section}
              selectedId={null}
              loading={list.loading}
              error={list.error}
              onOpen={openItem}
            />
          )}
        </div>
      </div>
    </div>
  );
}
