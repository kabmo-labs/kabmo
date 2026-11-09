/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The rows under an expanded session: real sessions, drawn compactly.
 *
 * These are NOT subagents. A subagent row is a tool call with a task name and
 * no session behind it; a child row opens `/sessions/:id`, carries the harness
 * mark in its usual leading position, and may itself have children. Keeping the
 * two lists separate is what stops one chevron from meaning two things.
 *
 * Indentation, not a second row style: the harness glyph stays where every
 * session row puts it, and the depth is the only visual difference.
 */

import { HarnessGlyph, HARNESS_GLYPH_SIZE } from '@/client/components/common/harness-glyph';
import { descendantsOf } from '@/client/lib/session-tree';
import type { SessionItemData } from '@/shared/types';

export interface ChildSessionListProps {
  parentId: string;
  childrenOf: Map<string, SessionItemData[]>;
  onSelect: (sessionId: string | number) => void;
}

function statusDot(session: SessionItemData): string {
  if (session.awaitingInput) return 'bg-amber-500';
  if (session.streamStatus === 'stream') return 'bg-emerald-500 animate-pulse';
  if (session.is_archived === 1) return 'bg-ink/20';
  return 'bg-ink/25';
}

export function ChildSessionList({ parentId, childrenOf, onSelect }: ChildSessionListProps) {
  const rows = descendantsOf(parentId, childrenOf);
  if (rows.length === 0) return null;

  return (
    <div data-testid="child-session-list" className="space-y-0.5">
      {rows.map(({ session, depth }) => {
        const title = session.title.charAt(0).toUpperCase() + session.title.slice(1);
        return (
          <button
            key={session.id}
            type="button"
            data-testid="child-session-row"
            data-session-id={String(session.id)}
            onClick={() => onSelect(session.id)}
            title={session.title}
            className="group/child flex w-full items-center rounded-lg py-1 pr-2 text-left text-xs text-ink/70 transition-colors cursor-pointer hover:bg-ink/5 hover:text-ink"
            style={{ paddingLeft: `${8 + depth * 12}px` }}
          >
            <span className={`mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(session)}`} aria-hidden="true" />
            {session.harness && (
              <span className="mr-1.5 flex shrink-0 items-center">
                <HarnessGlyph harness={session.harness} size={HARNESS_GLYPH_SIZE.compact} />
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{title}</span>
          </button>
        );
      })}
    </div>
  );
}
