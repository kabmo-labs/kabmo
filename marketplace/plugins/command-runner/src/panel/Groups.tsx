/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The command list, in two collapsible levels: a group per command FILE, and a
 * row per command inside it.
 *
 * ## Why grouping is not decoration
 *
 * In a monorepo `make build` in `packages/api/` is a different command from
 * `make build` at the root, and a script's relative path (`./scripts/gen.sh`)
 * only resolves when the cwd is the script's own directory — so the file IS the
 * command's identity and flattening the list would make two different commands
 * look like one. The group header is the repo-relative path, which is the only
 * thing distinguishing three `package.json` groups.
 *
 * ## The collapse is the git panel's, on both levels
 *
 * `.section-reveal` (`grid-template-rows: 0fr → 1fr`), a full-width `<button>`
 * carrying `aria-expanded`/`aria-controls`, the body left MOUNTED and `inert`
 * while collapsed. Both levels use it, so a group and a command behave the same
 * way and the reveal animates rather than the list jumping.
 *
 * **A collapsed group takes its rows OUT of the tab order** (`inert`), which is
 * the half that is easy to miss: without it, `Tab` walks into rows nobody can
 * see, and a screen reader announces a command inside a closed group.
 *
 * The flags are per FILE, keyed by the repo-relative path, and ABSENT MEANS
 * EXPANDED — the same shape the todo panel uses for its phases, and the reason a
 * workspace seen for the first time shows its commands rather than hiding them.
 */

import { useId } from 'preact/hooks';

import { CommandRow } from './Row';
import { Glyph, ICON } from './Glyph';
import type { Command, CommandGroup, RunLog, RunSummary } from '../protocol';

export interface CommandGroupsProps {
  groups: CommandGroup[];
  /** Every run this panel knows, so a row can find its own latest. */
  runs: RunSummary[];
  /** Files the user collapsed, by repo-relative path. Absent = expanded. */
  collapsedGroups: Record<string, boolean>;
  /** Which commands are tracked as background jobs, by command id. */
  background: Record<string, boolean>;
  /** The log of the run each open row is showing, by run id. */
  logs: Record<string, RunLog>;
  onToggleGroup: (file: string, collapsed: boolean) => void;
  onToggleBackground: (commandId: string, next: boolean) => void;
  onRun: (commandId: string) => void;
  onStop: (runId: string) => void;
  onReadLog: (runId: string) => void;
  /** Open the add/edit dialog. Absent when the panel cannot write. */
  onAdd?: () => void;
  onEdit?: (command: Command) => void;
  onRemove?: (command: Command) => void;
  /** The walk hit its cap, so the list is a prefix and says so. */
  truncated: boolean;
  /** Every filename the server's table claims, for the empty note. */
  sources: string[];
}

/**
 * The latest run per command id.
 *
 * Newest-first, so the first hit for an id is its most recent run — which is the
 * one a row shows. Matching on `commandId` and not on `file`+`label`: two
 * commands of one name in one file, or the same label in two files, would
 * otherwise share an expansion.
 */
export function latestRunByCommand(runs: readonly RunSummary[]): Map<string, RunSummary> {
  const byCommand = new Map<string, RunSummary>();
  for (const run of runs) {
    const current = byCommand.get(run.commandId);
    if (!current || run.startedAt > current.startedAt) byCommand.set(run.commandId, run);
  }
  return byCommand;
}

/** One file's group: a collapsible header, then its command rows. */
function CommandGroupSection({
  group,
  latest,
  collapsed,
  background,
  logs,
  onToggleGroup,
  onToggleBackground,
  onRun,
  onStop,
  onReadLog,
  onAdd,
  onEdit,
  onRemove,
}: {
  group: CommandGroup;
  latest: Map<string, RunSummary>;
  collapsed: boolean;
  background: Record<string, boolean>;
  logs: Record<string, RunLog>;
  onToggleGroup: (file: string, collapsed: boolean) => void;
  onToggleBackground: (commandId: string, next: boolean) => void;
  onRun: (commandId: string) => void;
  onStop: (runId: string) => void;
  onReadLog: (runId: string) => void;
  onAdd?: () => void;
  onEdit?: (command: Command) => void;
  onRemove?: (command: Command) => void;
}) {
  const bodyId = useId();

  /**
   * The user's own group is NOT collapsible.
   *
   * Two reasons, and the first is the one that decides it: the Add button lives
   * in this header, and a header that is a toggle swallows the click on its own
   * control (a button inside a button is invalid and the inner one never fires).
   * The second is that a list the user just added to should not be hidden by a
   * collapse they set on a file group before it existed.
   */
  const isCustom = group.customGroup === true;

  return (
    <section>
      {isCustom ? (
        <div className="sticky top-0 z-10 w-full flex items-center gap-1 px-3 py-1.5 bg-paper/95 backdrop-blur border-b border-ink/5">
          <span className="w-3 text-center font-mono" aria-hidden="true">
            ▾
          </span>
          <span className="font-semibold text-xs text-ink truncate" title={group.file}>
            {group.file}
          </span>
          {group.commands.length > 0 ? (
            <span className="flex-shrink-0 font-normal border border-ink/20 rounded-full px-1.5 text-[9px] text-ink/50">
              {group.commands.length}
            </span>
          ) : null}
          {onAdd ? (
            <button
              type="button"
              onClick={onAdd}
              title="Add your own command"
              aria-label="Add your own command"
              className="ml-auto flex-shrink-0 p-1 rounded text-ink/50 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
            >
              <Glyph path={ICON.plus} />
            </button>
          ) : null}
        </div>
      ) : (
        <>
          {/* The toggle fills the row, so clicking anywhere on it collapses —
              the lesson the git panel's stash header learned: a button wrapped
              around the LABEL alone leaves a dead strip in the middle of the
              row, and only the words respond. */}
          <button
        type="button"
        onClick={() => onToggleGroup(group.file, !collapsed)}
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        title={collapsed ? `Show ${group.file}` : `Hide ${group.file}`}
        className="sticky top-0 z-10 w-full flex items-center gap-1 px-3 py-1.5 bg-paper/95 backdrop-blur border-b border-ink/5 hover:bg-ink/5 transition-colors text-left cursor-pointer"
      >
        {/* The same disclosure mark as a command row and the git sections, in
            `font-mono` so it is the same SIZE: the identical codepoint at the
            identical font-size measures a quarter smaller in the app's sans
            stack. */}
        <span className="w-3 text-center" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        {/* The GROUP is the heading of this list, so it takes the git panel's
            section-header treatment: `font-semibold text-xs text-ink`. It used to
            be `text-[11px] font-mono text-ink/70` while a command row was
            `text-xs text-ink` — a SMALLER, FAINTER, monospaced group title over
            larger, darker commands, which is exactly backwards: the reader's eye
            landed on the rows and the heading read as metadata about them. */}
        <span className="font-semibold text-xs text-ink truncate" title={group.file}>
          {group.file}
        </span>
        {group.commands.length > 0 ? (
          <span className="ml-auto flex-shrink-0 font-normal border border-ink/20 rounded-full px-1.5 text-[9px] text-ink/50">
            {group.commands.length}
          </span>
        ) : null}
          </button>
        </>
      )}

      {/* Mounted in both states so the reveal animates; `inert` while collapsed
          so the rows inside leave the tab order and the accessibility tree. The
          direct child carries NO padding — `overflow: hidden` clips the content
          box, so padding there would leave a sliver visible under a closed
          group. */}
      <div className="section-reveal" data-expanded={isCustom || !collapsed} id={bodyId} inert={!isCustom && collapsed}>
        <div>
          {group.error ? (
            <p className="px-3 py-1.5 text-[11px] text-error">{group.error}</p>
          ) : (
            <>
              {isCustom && group.commands.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-ink/45">
                  No commands of your own yet. Use + to add one.
                </p>
              ) : null}
              {group.commands.map((command) => {
                const run = latest.get(command.id) ?? null;
                return (
                  <CommandRow
                    key={command.id}
                    command={command}
                    file={group.file}
                    run={run}
                    log={run ? (logs[run.id] ?? null) : null}
                    background={background[command.id] === true}
                    onToggleBackground={onToggleBackground}
                    onRun={onRun}
                    onStop={onStop}
                    onReadLog={onReadLog}
                    {...(onEdit ? { onEdit } : {})}
                    {...(onRemove ? { onRemove } : {})}
                  />
                );
              })}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export function CommandGroups({
  groups,
  runs,
  collapsedGroups,
  background,
  logs,
  onToggleGroup,
  onToggleBackground,
  onRun,
  onStop,
  onReadLog,
  onAdd,
  onEdit,
  onRemove,
  truncated,
  sources,
}: CommandGroupsProps) {
  const latest = latestRunByCommand(runs);

  /**
   * Whether the walk found anything.
   *
   * Not `groups.length === 0`: the user's own group is always present, so the
   * list is never empty — and the note below is the thing that has to survive,
   * because "no command file found" is a real answer and the reader needs to know
   * WHICH files were looked for.
   */
  const foundFiles = groups.some((group) => group.customGroup !== true);

  return (
    <div className="pb-2">
      {groups.map((group) => (
        <CommandGroupSection
          key={group.file}
          group={group}
          latest={latest}
          // Absent means COLLAPSED: the panel opens as a list of files, and a
          // reader opens the one they came for. Only an explicit `false`
          // (the user expanded it) shows the rows.
          collapsed={collapsedGroups[group.file] !== false}
          background={background}
          logs={logs}
          onToggleGroup={onToggleGroup}
          onToggleBackground={onToggleBackground}
          onRun={onRun}
          onStop={onStop}
          onReadLog={onReadLog}
          {...(onAdd ? { onAdd } : {})}
          {...(onEdit ? { onEdit } : {})}
          {...(onRemove ? { onRemove } : {})}
        />
      ))}

      {!foundFiles ? <NoSourcesNote sources={sources} /> : null}

      {truncated ? (
        <p className="px-3 py-2 text-[11px] text-ink/45">
          Listing the first {groups.length} command files — this repository has more than the scan reads.
        </p>
      ) : null}
    </div>
  );
}

/**
 * What was looked for, when nothing was found.
 *
 * The list is long now (a source per toolchain), so it is NAMED rather than
 * printed in full: the first few tell the reader what kind of file this is
 * looking for, and the `title` carries every one for the reader who wants to
 * check whether their toolchain is covered. Printing twenty filenames would push
 * the Add button off a 320px panel.
 */
function NoSourcesNote({ sources }: { sources: string[] }) {
  const shown = sources.slice(0, 4);
  return (
    <p className="px-3 py-2 text-[11px] text-ink/45" title={sources.join(', ')}>
      No command file found. This looks for {shown.map((name) => `${name}, `)}
      {sources.length > shown.length ? `and ${sources.length - shown.length} more — hover to see all.` : null}
    </p>
  );
}
