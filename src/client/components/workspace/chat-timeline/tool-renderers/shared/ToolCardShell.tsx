/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shell every tool call renders in — header, status, facts, body.
 *
 * Two rules shape it:
 *
 * 1. **The collapsed header states the outcome.** A closed card used to carry
 *    only a title and a "Done" badge, so a `bash` that exited 0 and one that
 *    failed were the same card, and a `grep` never named its pattern. The facts
 *    come from `toolSummary` (`shared/lib/chat/tool/summary.ts`), which reads
 *    the `details` omp already sends — measured present on 95–100% of results.
 *
 * 2. **The toggle is a real control.** It carries an `aria-label` naming the
 *    tool and its subject, because an icon-only chevron with a truncated title
 *    is unreachable by screen reader, and `aria-expanded` alone does not say
 *    what is being expanded.
 */

import { useState } from 'preact/hooks';
import type { ReactNode } from 'preact/compat';
import { AlertCircle, Check, ChevronDown, CircleSlash, Loader2, OctagonX } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import { isSkippedTool } from '@/shared/lib/chat/tool-status';
import type { ToolSummary } from '@/shared/lib/chat/tool/summary';
import { ToolFactChips } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/ToolFactChips';

interface ToolCardShellProps {
  tool: ToolCallData;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  /** Facts derived from the result — rendered as chips in the header. */
  summary?: ToolSummary | null;
  /** Extra trailing controls (a diff toggle, a copy button). */
  actions?: ReactNode;
  isOpen?: boolean;
  onToggle?: () => void;
  defaultExpanded?: boolean;
  /** Render the body permanently — no collapse state, no chevron. */
  alwaysExpanded?: boolean;
  children?: ReactNode;
}

function statusDot(status: ToolCallData['status'], isSkipped: boolean) {
  const base = 'h-1.5 w-1.5 rounded-full';
  if (status === 'running') return <span className={`${base} bg-ink/60 animate-pulse`} />;
  if (isSkipped) return <span className={`${base} bg-ink/30`} />;
  if (status === 'error') return <span className={`${base} bg-error`} />;
  return <span className={`${base} bg-success`} />;
}

const BADGE_BASE = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold';

/** The outcome word for a card. `aborted` and a synthetic call are distinct
 *  outcomes from `skipped`, and omp records both — collapsing them into
 *  "Skipped" told the reader the model declined when the user had interrupted. */
function statusBadge(tool: ToolCallData) {
  if (tool.status === 'aborted') {
    return (
      <span className={`${BADGE_BASE} bg-warning/10 text-warning`}>
        <OctagonX size={10} /> Aborted
      </span>
    );
  }
  if (isSkippedTool(tool)) {
    return (
      <span className={`${BADGE_BASE} bg-ink/8 text-ink/50`}>
        <CircleSlash size={10} /> Skipped
      </span>
    );
  }

  const status = tool.status || (tool.error ? 'error' : 'success');
  if (status === 'error') {
    return (
      <span className={`${BADGE_BASE} bg-error/10 text-error`}>
        <AlertCircle size={10} /> Failed
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className={`${BADGE_BASE} bg-ink/8 text-ink/60`}>
        <Loader2 size={10} className="animate-spin" /> Running
      </span>
    );
  }
  return (
    <span className={`${BADGE_BASE} bg-success/10 text-success`}>
      <Check size={10} /> Done
    </span>
  );
}

/** Shell card collapsible untuk semua tool call — header + body konsisten. */
export function ToolCardShell({
  tool,
  icon,
  title,
  subtitle,
  summary,
  actions,
  isOpen: controlledIsOpen,
  onToggle,
  defaultExpanded = false,
  alwaysExpanded = false,
  children,
}: ToolCardShellProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(defaultExpanded);
  const collapsible = !alwaysExpanded;
  const isExpanded = alwaysExpanded || (controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen);
  const status = tool.status || (tool.error ? 'error' : 'success');
  const isRunning = status === 'running';
  const hasBody = Boolean(children);

  const handleToggle = () => {
    if (!hasBody || !collapsible) return;
    if (onToggle) onToggle();
    else setInternalIsOpen((prev) => !prev);
  };

  const isSkipped = isSkippedTool(tool);
  const toggleLabel = `${isExpanded ? 'Collapse' : 'Expand'} ${title}${subtitle ? ` — ${subtitle}` : ''}`;

  return (
    <div
      className={`group overflow-hidden rounded-xl border transition-all duration-200 ${
        status === 'error' && !isSkipped
          ? 'border-error/25 bg-error/[0.03]'
          : isRunning
            ? 'border-ink/15 bg-paper'
            : isSkipped
              ? 'border-dashed border-ink/15 bg-paper/60 opacity-80'
              : 'border-ink/10 bg-paper hover:border-ink/20'
      } ${isExpanded ? 'shadow-sm' : ''}`}
    >
      <button
        type="button"
        onClick={handleToggle}
        disabled={!hasBody || !collapsible}
        aria-expanded={isExpanded}
        aria-label={hasBody && collapsible ? toggleLabel : undefined}
        className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
          hasBody && collapsible ? 'cursor-pointer hover:bg-ink/[0.03]' : 'cursor-default'
        } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20`}
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
            status === 'error' && !isSkipped
              ? 'bg-error/10 text-error'
              : isRunning
                ? 'bg-ink/8 text-ink'
                : 'bg-ink/5 text-ink/70 group-hover:bg-ink/8'
          }`}
        >
          {icon}
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-semibold tracking-tight text-ink">{title}</span>
            {statusDot(status, isSkipped)}
          </span>
          {/* ONE meta line, and none at all once expanded.
              The identity (subtitle) and the outcome (facts) used to be two
              stacked rows, so a `bash` card drew `Bash` / `cd /Users/…` /
              `599ms · 17 lines` — three lines for a collapsed card, and the
              reader's "why does bash have two subtitle lines". They share one
              row now: the subtitle truncates (it is the long half) and the
              chips stay whole, because a half-ellipsized fact reads as a wrong
              fact.
              Hiding it on expand mirrors `ThinkingSection`: the body carries
              the path, the command and the output, so repeating the summary
              above it is noise. */}
          {!isExpanded && (subtitle || (summary && summary.facts.length > 0)) && (
            <span className="flex min-w-0 items-center gap-2 overflow-hidden">
              {subtitle && (
                <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink/45">{subtitle}</span>
              )}
              {summary && summary.facts.length > 0 && (
                <ToolFactChips facts={summary.facts} max={subtitle ? 2 : 4} />
              )}
            </span>
          )}
        </span>

        <span className="flex shrink-0 items-center gap-2">
          {actions}
          {statusBadge(tool)}
          {hasBody && collapsible && (
            <ChevronDown
              size={14}
              className={`text-ink/35 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            />
          )}
        </span>
      </button>

      {isExpanded && hasBody && (
        <div className="border-t border-ink/8 bg-canvas/40 px-3 py-3 code-surface">
          {children}
        </div>
      )}
    </div>
  );
}
