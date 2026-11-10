/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One subagent in a session's branch.
 *
 * A subagent is a leaf: it is a tool call, not a session, and it opens the
 * subagent transcript rather than `/sessions/:id`. The robot mark replaces the
 * harness mark in the same column every session row puts it, and the leading
 * 16px slot is the SHARED slot rule — one glyph there, and for a leaf that
 * glyph is the run state, exactly as a parent row shows a status when it has
 * no branch to disclose.
 */

import { Bot, Square } from 'lucide-preact';
import { useSearchParams } from '@/client/lib/router/search-params';
import { SubagentStatusIcon } from '@/client/components/common/SubagentStatusIcon';
import type { BranchRowStyle } from '@/client/components/common/session-branch/style';
import { subagentRowLabel } from '@/shared/lib/omp/subagent/label';
import { cancelSubagent } from '@/shared/lib/omp/subagent/control';
import type { SubagentInfo } from '@/shared/types';

export interface SubagentRowProps {
  subagent: SubagentInfo;
  /** The session that owns the roster; the view event and cancel address it. */
  sessionId: string;
  style: BranchRowStyle;
  /** A live run this process can stop (and show as pulsing). */
  running: boolean;
}

export function SubagentRow({ subagent, sessionId, style, running }: SubagentRowProps) {
  const [searchParams] = useSearchParams();
  const viewed = subagent.id === searchParams.get('subagent');
  const label = subagentRowLabel(subagent);
  const brief = subagent.task ?? subagent.assignment ?? subagent.description ?? label;

  return (
    <div className="group/subagent-row flex items-center">
      <button
        type="button"
        title={brief}
        onClick={() => window.dispatchEvent(
          new CustomEvent('omp:view-subagent', { detail: { sessionId, subagent } }),
        )}
        className={`flex-1 min-w-0 flex items-center text-left text-xs rounded-md ${style.inset} ${style.padding} cursor-pointer transition-colors select-none ${
          viewed ? 'bg-ink/10 font-medium text-ink' : 'text-ink/70 hover:text-ink hover:bg-ink/5'
        }`}
      >
        <span
          data-testid="subagent-status-slot"
          className="w-4 h-4 flex items-center justify-center shrink-0"
        >
          <SubagentStatusIcon status={subagent.status} live={running} size={11} />
        </span>
        <span className="w-2 shrink-0" />
        <span data-testid="subagent-mark" className="mr-1.5 flex shrink-0 items-center text-ink/55">
          <Bot size={style.glyph} aria-hidden="true" />
        </span>
        <span className="flex-1 min-w-0 truncate leading-snug">{label}</span>
      </button>
      {running && (
        <button
          type="button"
          title="Stop this subagent"
          aria-label="Stop this subagent"
          onClick={() => void cancelSubagent(sessionId, subagent.id)}
          className="touch-visible shrink-0 mr-1 w-5 h-5 flex items-center justify-center rounded text-ink/40 hover:text-error hover:bg-error/5 opacity-0 group-hover/subagent-row:opacity-100 transition-opacity cursor-pointer"
        >
          <Square size={10} />
        </button>
      )}
    </div>
  );
}
