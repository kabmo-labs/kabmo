/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Command Runner panel: the header, and the states that are not "empty".
 *
 * Three things are decided here and each is a bug shape if dropped:
 *
 * - **Emptiness is `!workspacePath`, never `!enabled`.** The host's `enabled` is
 *   "you may read", and it is false for two different reasons: another view is on
 *   screen (the desktop stack hides inactive views), or there is no workspace
 *   folder. A panel that read it as "the user closed me" would draw an empty
 *   state over a live one; a panel that ignored it would read a root it does not
 *   have. The workspace is what actually decides.
 * - **A refusal is REPORTED.** `at_capacity`, a failed spawn and a file that
 *   would not parse all name a reason, and a row that swallowed one would look
 *   like a command that did nothing.
 * - **The header holds no per-command setting.** `Background` and `Output` used
 *   to live here as the defaults for every run; they are now each command's own
 *   Enable / Disable on its row, because `dev` and `lint` want opposite things
 *   and one pair of checkboxes cannot say both. What is left is the scope: which
 *   repo, and a rescan.
 */

import { useRepoScope } from '@kabmo-labs/kabmo-ui';
import { Empty, Note } from '@kabmo-labs/kabmo-ui/components';

import { CommandGroups } from './Groups';
import { CustomForm } from './CustomForm';
import { PanelHeader } from './Header';
import type { Command, CommandListing, CustomCommand, RunLog, RunSummary } from '../protocol';

export interface PanelViewProps {
  listing: CommandListing | null;
  listingError: string | null;
  loading: boolean;
  /** Every run this panel knows, so each row can find its own latest. */
  runs: RunSummary[];
  /** Files the user collapsed, by repo-relative path. Absent = expanded. */
  collapsedGroups: Record<string, boolean>;
  /** Which commands are tracked as background jobs, by command id. */
  background: Record<string, boolean>;
  /** The log each open row is showing, by run id. */
  logs: Record<string, RunLog>;
  /** The scope every request carries, or null with no workspace. */
  scope: { root: string; repo: string } | null;
  /** False in the phone's drawer, which draws its own tab strip above the view. */
  showHeader: boolean;
  onToggleGroup: (file: string, collapsed: boolean) => void;
  onToggleBackground: (commandId: string, next: boolean) => void;
  onRefresh: () => void;
  onRun: (commandId: string) => void;
  onStop: (runId: string) => void;
  onReadLog: (runId: string) => void;
  /** True while the add/edit dialog is open. */
  formOpen: boolean;
  /** The command being edited, or null when the dialog is adding one. */
  editing: CustomCommand | null;
  /** The repo-relative directory a new command should default to. */
  defaultCwd: string;
  /** The server's refusal of the last save, when it refused. */
  formError: string | null;
  onAdd: () => void;
  onEdit: (command: Command) => void;
  onRemove: (command: Command) => void;
  onSubmit: (input: { command: string; scope: 'global' | 'repo'; cwd: string; previousId: string | null }) => void;
  onCancelForm: () => void;
}

/**
 * The panel's own chrome: the scope header, then the grouped command rows, or
 * the state that explains why there are none.
 */
export function PanelView({
  listing,
  listingError,
  loading,
  runs,
  collapsedGroups,
  background,
  logs,
  scope,
  showHeader,
  onToggleGroup,
  onToggleBackground,
  onRefresh,
  onRun,
  onStop,
  onReadLog,
  formOpen,
  editing,
  defaultCwd,
  formError,
  onAdd,
  onEdit,
  onRemove,
  onSubmit,
  onCancelForm,
}: PanelViewProps) {
  const repo = useRepoScope();

  return (
    <div className="flex flex-col h-full w-full bg-paper text-ink">
      <PanelHeader scope={repo} showHeader={showHeader} onRefresh={onRefresh} />

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-overlay-container">
        {!scope ? (
          // Not "no session selected": the panel is not gated on a session, and a
          // session with no workspace folder is the state this names.
          <Empty>
            <span className="text-xs">No workspace folder is active. Open a folder to list its commands.</span>
          </Empty>
        ) : (
          <>
            {listingError ? (
              <div className="px-3 py-2">
                <Note tone="error">{listingError}</Note>
              </div>
            ) : null}

            {loading && !listing ? (
              <div className="px-3 py-2 text-xs text-ink/40">Scanning…</div>
            ) : (
              <CommandGroups
                groups={listing?.groups ?? []}
                runs={runs}
                collapsedGroups={collapsedGroups}
                background={background}
                logs={logs}
                onToggleGroup={onToggleGroup}
                onToggleBackground={onToggleBackground}
                onRun={onRun}
                onStop={onStop}
                onReadLog={onReadLog}
                onAdd={onAdd}
                onEdit={onEdit}
                onRemove={onRemove}
                truncated={listing?.truncated ?? false}
                sources={listing?.sources ?? []}
              />
            )}
          </>
        )}
      </div>

      {/* The dialog is rendered INSIDE the panel rather than in a portal: the
          right panel is not the whole document, and a fixed-position overlay
          from here already covers the viewport. Mounted only when open, so its
          fields start from the entry being edited — a reset effect would run
          after paint and wipe anything typed in that window. */}
      {formOpen ? (
        <CustomForm
          editing={editing}
          root={scope?.root ?? null}
          defaultCwd={defaultCwd}
          error={formError}
          onCancel={onCancelForm}
          onSubmit={onSubmit}
        />
      ) : null}
    </div>
  );
}
