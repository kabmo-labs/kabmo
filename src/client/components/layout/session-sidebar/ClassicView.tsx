/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `classic` sidebar style: the toolbar of boxed icons over compact rows.
 *
 * This is the chrome Kabmo shipped before the style setting existed, moved out
 * of `SessionsView` VERBATIM — same components, same props, same order — so the
 * default style renders the DOM it always did. `SessionsView` is the dispatcher
 * that owns the controller, the dialogs and the batch confirmation; this file
 * only decides how the toolbar and the list look.
 *
 * The batch bar is NOT here: it is the same bar in both styles, so the
 * dispatcher draws it once, below whichever style is on screen.
 */

import { useState } from 'preact/hooks';
import { SessionSidebarToolbar } from '@/client/components/layout/session-sidebar/Toolbar';
import { SessionSidebarSessionList } from '@/client/components/layout/session-sidebar/SessionList';
import { SessionListSkeleton } from '@/client/components/layout/session-sidebar/Skeleton';
import type { SessionSidebarVariantProps } from '@/client/components/layout/session-sidebar/variant-props';

export function ClassicSidebarView({
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
}: SessionSidebarVariantProps) {
  // Search is a MODE in this style — a toggle in the toolbar opens the field —
  // so the visibility is local to the chrome. The query itself is the
  // dispatcher's: switching styles must not drop what the user typed.
  const [searchOpen, setSearchOpen] = useState(false);
  // A query that survived a style switch (or a reload of the classic toolbar's
  // own toggle) keeps the field OPEN: the list behind it is filtered, and a
  // hidden field would leave a short list with nothing on screen explaining why.
  const searchVisible = searchOpen || searchQuery.length > 0;
  const batchActive = Boolean(batch);

  return (
    <div className={`flex flex-col ${className}`}>
      <SessionSidebarToolbar
        isSearchVisible={searchVisible}
        searchQuery={searchQuery}
        showArchived={showArchived}
        optionsOpen={optionsOpen}
        sortOption={sortOption}
        onToggleSearch={() => {
          if (searchVisible) {
            // Hiding the field cannot leave the list filtered: the query is the
            // only explanation for a short list, so closing search restores the
            // full list with it. (A query that arrived from the other style is
            // therefore dropped on the same click.)
            setSearchOpen(false);
            onSearchChange('');
          } else {
            setSearchOpen(true);
          }
        }}
        onSearchChange={onSearchChange}
        onToggleArchived={onToggleArchived}
        onHideArchived={onToggleArchived}
        onToggleOptions={onToggleOptions}
        onCloseOptions={onCloseOptions}
        onSortChange={onSortChange}
        onNewSession={onNewSession}
        onNewWorkspace={onNewWorkspace}
        onScheduler={onScheduler}
        scheduledCount={scheduledCount}
        onRefresh={onRefresh}
        refreshing={refreshing}
        onSelectWorkspaces={onSelectWorkspaces}
        selecting={batchActive}
      />

      {initializing ? (
        <SessionListSkeleton />
      ) : (
        <SessionSidebarSessionList
          folders={folders}
          activeSessionId={activeSessionId}
          searchQuery={searchQuery}
          showArchived={showArchived}
          sessionStatus={sessionStatus}
          onSelectSession={onSelectSession}
          onNewSessionForFolder={onNewSessionForFolder}
          onNewWorktreeSession={onNewWorktreeSession}
          onToast={onToast}
          batch={batch}
          onStartSessionSelection={onStartSessionSelection}
          onCancelWait={onCancelWait}
        />
      )}
    </div>
  );
}
