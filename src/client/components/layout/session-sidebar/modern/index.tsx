/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `modern` sidebar style: search line, focus chips, sticky workspaces.
 *
 * It receives the same `SessionSidebarVariantProps` the classic style does, so
 * every action in this chrome is the same server call and the same dialog —
 * `SessionsView` owns those, and this file cannot diverge from it.
 *
 * What is local to the chrome, and therefore lost when the style is switched
 * away from, is only presentation: which focus chip is on, whether the search
 * field has the caret. The QUERY is not local — it lives in the dispatcher, so
 * switching styles mid-search keeps the results.
 *
 * Two empty states, both explicit: a query with no matches and a focus with
 * nothing running say which filter is responsible, rather than drawing an empty
 * column the user cannot explain.
 */

import { useMemo, useState } from 'preact/hooks';
import { SearchField } from '@/client/components/layout/session-sidebar/modern/SearchField';
import { FilterChips } from '@/client/components/layout/session-sidebar/modern/FilterChips';
import { SidebarActionRow } from '@/client/components/layout/session-sidebar/modern/ActionRow';
import { WorkspaceSection } from '@/client/components/layout/session-sidebar/modern/WorkspaceSection';
import { ModernSidebarSkeleton } from '@/client/components/layout/session-sidebar/modern/Skeleton';
import {
  focusFolders,
  runningSessionCount,
  type SessionFocus,
} from '@/shared/lib/workspace/session-focus';
import type { SessionSidebarVariantProps } from '@/client/components/layout/session-sidebar/variant-props';

export function ModernSidebarView({
  className = '',
  folders,
  initializing,
  activeSessionId,
  sessionStatus,
  searchQuery,
  onSearchChange,
  showArchived,
  onToggleArchived,
  sortOption,
  optionsOpen,
  onToggleOptions,
  onCloseOptions,
  onSortChange,
  onRefresh,
  refreshing,
  scheduledCount,
  onNewSession,
  onNewWorkspace,
  onScheduler,
  onSelectSession,
  onNewSessionForFolder,
  onNewWorktreeSession,
  onToast,
  onCancelWait,
  batch,
  onSelectWorkspaces,
  onStartSessionSelection,
  touch = false,
}: SessionSidebarVariantProps & { /** Phone drawer: taller targets and rows. */ touch?: boolean }) {
  const [focus, setFocus] = useState<SessionFocus>('all');
  const runningCount = useMemo(
    () => runningSessionCount(folders, (id) => sessionStatus[id]),
    [folders, sessionStatus],
  );
  const visible = useMemo(
    () => focusFolders(folders, { focus, statusOf: (id) => sessionStatus[id] }),
    [folders, focus, sessionStatus],
  );
  // The binding only exists while a mode is active, so its presence IS the
  // "selecting" flag — the same test the classic chrome makes.
  const selecting = Boolean(batch);

  // `flex-1 min-h-0`: the dispatcher draws the batch bar below this chrome in
  // the same column (see `ClassicView`).
  return (
    <div className={`flex flex-col ${className}`}>
      <SearchField value={searchQuery} onChange={onSearchChange} touch={touch} />

      <FilterChips
        focus={focus}
        onFocusChange={setFocus}
        runningCount={runningCount}
        showArchived={showArchived}
        onToggleArchived={onToggleArchived}
        selecting={selecting}
        onToggleSelect={onSelectWorkspaces}
      />

      <SidebarActionRow
        onNewSession={onNewSession}
        onNewWorkspace={onNewWorkspace}
        onScheduler={onScheduler}
        scheduledCount={scheduledCount}
        onRefresh={onRefresh}
        refreshing={refreshing}
        sortOption={sortOption}
        optionsOpen={optionsOpen}
        onToggleOptions={onToggleOptions}
        onCloseOptions={onCloseOptions}
        onSortChange={onSortChange}
        touch={touch}
      />

      <div className="mt-1 flex-1 scrollbar-overlay-container px-2 pb-3">
        {initializing ? (
          <ModernSidebarSkeleton touch={touch} />
        ) : visible.length === 0 ? (
          <div className="px-1 py-8 text-center text-[11px] leading-relaxed text-ink/40">
            {focus === 'running'
              ? 'Nothing is running right now.'
              : searchQuery
                ? 'No workspace or chat matches that search.'
                : 'No workspaces yet.'}
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((folder) => (
              <WorkspaceSection
                key={folder.id}
                folder={folder}
                activeSessionId={activeSessionId}
                sessionStatus={sessionStatus}
                showArchived={showArchived}
                forceExpanded={Boolean(searchQuery)}
                density={touch ? 'touch' : 'compact'}
                batch={batch}
                onSelectSession={onSelectSession}
                onNewSessionForFolder={onNewSessionForFolder}
                onNewWorktreeSession={onNewWorktreeSession}
                onToast={onToast}
                onStartSessionSelection={onStartSessionSelection}
                onCancelWait={onCancelWait}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
