/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The branch under ONE session row: its child sessions first, then its
 * subagents, drawn as one tree.
 *
 * A session has exactly one disclosure. Before this, children and the subagent
 * roster were two lists behind two controls (a chevron and a `Boxes` badge),
 * which is why a row could be open in one sense and closed in the other. Now
 * the chevron opens this branch, and the branch is the union of the two.
 *
 * Ordering is the order the lists already had: child sessions (the sidebar's
 * own sort), then the roster (its own batch/index order). A child session can
 * itself have a branch, so the renderer recurses one level per child — the
 * guide cells carry the depth, not a second row style.
 *
 * The chrome owns the row component (classic, modern, mobile), so it supplies
 * `renderSession`; everything below that is shared, including the subagent
 * rows and the tree lines.
 */

import { Fragment } from 'preact';
import type { ComponentChild } from 'preact';
import { BranchGuides } from '@/client/components/common/session-branch/BranchGuides';
import { SubagentRow } from '@/client/components/common/session-branch/SubagentRow';
import type { BranchRowStyle } from '@/client/components/common/session-branch/style';
import { useSubagentRoster } from '@/client/hooks/chat/subagents/roster';
import type { SessionItemData } from '@/shared/types';

/** What the chrome's row needs to know about its branch. */
export interface BranchControl {
  /** The row has child sessions, subagents, or both. */
  expandable: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  /**
   * This row is a CHILD session (it is drawn inside a branch). A leaf child
   * has no chevron and no run cue, so its leading slot is otherwise empty; the
   * row draws a child mark there instead of leaving a hole.
   */
  isChild: boolean;
}

/**
 * The control a session row gets from its own subtree and the one expansion
 * set. Shared by all three chromes: a row that is expandable in one layout and
 * not in another is the same defect as two different branch lists.
 */
export function branchControlFor(
  session: SessionItemData,
  childrenOf: Map<string, SessionItemData[]>,
  expandedIds: ReadonlySet<string>,
  onToggle: (sessionId: string) => void,
  isChild = false,
): BranchControl {
  const key = String(session.id);
  return {
    expandable: (childrenOf.get(key)?.length ?? 0) > 0 || Boolean(session.hasSubagents),
    isExpanded: expandedIds.has(key),
    onToggleExpand: () => onToggle(key),
    isChild,
  };
}

export interface SessionBranchProps {
  /** The session whose branch this is. */
  parentId: string;
  /** That session's own `hasSubagents` flag; false skips the roster read. */
  hasSubagents: boolean;
  childrenOf: Map<string, SessionItemData[]>;
  /** One set for both halves of the branch. */
  expandedIds: ReadonlySet<string>;
  onToggle: (sessionId: string) => void;
  /** The session the URL has open, so its roster can take live frames. */
  activeSessionId: string | null;
  renderSession: (session: SessionItemData, control: BranchControl) => ComponentChild;
  style: BranchRowStyle;
  /** `isLast` of each ancestor row, outermost first. */
  ancestors?: readonly boolean[];
}

export function SessionBranch({
  parentId,
  hasSubagents,
  childrenOf,
  expandedIds,
  onToggle,
  activeSessionId,
  renderSession,
  style,
  ancestors = [],
}: SessionBranchProps) {
  const children = childrenOf.get(parentId) ?? [];
  const { subagents, isLoading } = useSubagentRoster(parentId, activeSessionId === parentId, hasSubagents);
  const rows = [
    ...children.map((session) => ({ kind: 'session' as const, session })),
    ...subagents.map((subagent) => ({ kind: 'subagent' as const, subagent })),
  ];

  if (rows.length === 0) {
    if (!isLoading) return null;
    return (
      <div data-testid="session-branch" className="space-y-0.5">
        <div className="flex items-stretch">
          <BranchGuides ancestors={ancestors} isLast first style={style} />
          <div className={`flex min-w-0 flex-1 items-center text-xs italic text-ink/40 ${style.inset} ${style.padding}`}>
            Loading subagents…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="session-branch" className="space-y-0.5">
      {rows.map((row, index) => {
        const isLast = index === rows.length - 1;
        if (row.kind === 'subagent') {
          return (
            <div key={`subagent:${row.subagent.id}`} className="flex items-stretch">
              <BranchGuides ancestors={ancestors} isLast={isLast} first={index === 0} style={style} />
              <div className="min-w-0 flex-1">
                <SubagentRow
                  subagent={row.subagent}
                  sessionId={parentId}
                  style={style}
                  running={activeSessionId === parentId && row.subagent.status === 'started'}
                />
              </div>
            </div>
          );
        }

        const key = String(row.session.id);
        const childCount = childrenOf.get(key)?.length ?? 0;
        const control: BranchControl = {
          expandable: childCount > 0 || Boolean(row.session.hasSubagents),
          isExpanded: expandedIds.has(key),
          onToggleExpand: () => onToggle(key),
          isChild: true,
        };
        return (
          <Fragment key={key}>
            <div className="flex items-stretch">
              <BranchGuides ancestors={ancestors} isLast={isLast} first={index === 0} style={style} />
              <div className="min-w-0 flex-1">{renderSession(row.session, control)}</div>
            </div>
            {control.isExpanded && (
              <SessionBranch
                parentId={key}
                hasSubagents={Boolean(row.session.hasSubagents)}
                childrenOf={childrenOf}
                expandedIds={expandedIds}
                onToggle={onToggle}
                activeSessionId={activeSessionId}
                renderSession={renderSession}
                style={style}
                ancestors={[...ancestors, isLast]}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
