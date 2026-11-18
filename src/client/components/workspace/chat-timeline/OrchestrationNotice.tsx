/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The card a Kabmo-injected prompt wears in the timeline.
 *
 * A delegating message, a worker brief and a child outcome all reach omp as
 * `role: "user"` turns, because that is the only channel Kabmo can inject
 * through. Drawn as bubbles they are indistinguishable from something the
 * operator typed: a 1 KB orchestration contract with shell heredocs, a worker
 * preamble quoting its own session id, a report from a session nobody is
 * looking at. All three belong to Kabmo, not to the person reading the
 * transcript, so they get a card with a label and a collapse control instead.
 *
 * The OPERATOR'S OWN WORDS still render as their bubble (`MessageItem` splits
 * the envelope's trailing text out); this card only ever holds the injected
 * half. That split is the whole reason the envelope wraps the injection rather
 * than replacing the message: a delegating prompt is contract + the sentence
 * they actually wrote, and dropping the sentence would rewrite their turn.
 */

import { useMemo, useState } from 'preact/hooks';
import { AlertCircle, ArrowRightLeft, CheckCircle2, ChevronDown, Info, Workflow, XCircle } from 'lucide-preact';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { transcriptGutter } from '@/shared/lib/chat/timeline/gutter';
import { blockChrome } from '@/shared/lib/chat/timeline/block-chrome';
import { useToolRenderMode } from '@/client/hooks/chat/timeline/tool-render-mode';
import {
  parseChildOutcomeNotice,
  type ChildOutcomeEntry,
  type OrchestrationBlock,
} from '@/shared/lib/chat/orchestration/notice';

const KIND_LABEL: Record<OrchestrationBlock['kind'], string> = {
  contract: 'Orchestration',
  worker: 'Dispatched worker',
  outcome: 'Worker outcome',
};

const KIND_ICON: Record<OrchestrationBlock['kind'], typeof Workflow> = {
  contract: Workflow,
  worker: ArrowRightLeft,
  outcome: Info,
};

const STATUS_STYLE: Record<ChildOutcomeEntry['status'], { label: string; icon: typeof CheckCircle2; badge: string }> = {
  completed: { label: 'Completed', icon: CheckCircle2, badge: 'bg-success/10 text-success' },
  failed: { label: 'Failed', icon: XCircle, badge: 'bg-error/10 text-error' },
  interrupted: { label: 'Interrupted', icon: AlertCircle, badge: 'bg-warning/10 text-warning' },
};

/** How many workers a contract names — the count is the card's one-line
 *  summary, and the spawn command is what a contract is made of. */
function workerCount(body: string): number {
  return body.match(/--harness\s+\S+/g)?.length ?? 0;
}

/** The collapsed subtitle for one kind. Deliberately short: the whole body is
 *  one click away, and a truncated heredoc tells the reader nothing. */
function subtitleOf(block: OrchestrationBlock): string {
  if (block.kind === 'contract') {
    const count = workerCount(block.body);
    return count === 1 ? '1 worker' : `${count} workers`;
  }
  if (block.kind === 'worker') {
    const task = block.body.split(/\r?\nTASK\r?\n/)[1]?.trim() ?? '';
    const first = task.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return first ?? 'No task text';
  }
  const entries = parseChildOutcomeNotice(block.body);
  if (entries.length === 0) return 'No outcome recorded';
  if (entries.length === 1) {
    const entry = entries[0] as ChildOutcomeEntry;
    const name = entry.title || entry.sessionId;
    // The reason rides the collapsed line: a card that only says "failed" makes
    // the reader open it to learn whether it matters.
    return entry.status === 'completed' ? name : `${name} — ${entry.failure ?? entry.status}`;
  }
  return `${entries.length} workers`;
}

function OutcomeEntry({ entry, showStatus }: { entry: ChildOutcomeEntry; showStatus: boolean }) {
  const style = STATUS_STYLE[entry.status];
  const Icon = style.icon;
  return (
    <div className="space-y-1.5 rounded-lg border border-ink/8 bg-paper p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {/* A single worker's verdict is already on the card's header; repeating
            it here reads as two different results. */}
        {showStatus && (
          <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${style.badge}`}>
            <Icon size={10} />
            {style.label}
          </span>
        )}
        {entry.title && <span className="truncate text-[12px] font-medium text-ink">{entry.title}</span>}
        <span className="truncate font-mono text-[10px] text-ink/45">{entry.sessionId}</span>
      </div>
      {entry.status === 'completed' ? (
        <div className="text-[11.5px] leading-relaxed text-ink/85">
          <MarkdownRenderer content={entry.output?.trim() || 'No final output was recorded.'} />
        </div>
      ) : (
        <p className="font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap text-ink/80">
          {entry.failure?.trim() || 'The worker gave no reason.'}
        </p>
      )}
    </div>
  );
}

export interface OrchestrationNoticeProps {
  block: OrchestrationBlock;
  /** Phone layout: the card's frame is the timeline gutter itself. */
  isMobile?: boolean;
}

export function OrchestrationNotice({ block, isMobile = false }: OrchestrationNoticeProps) {
  const mode = useToolRenderMode();
  const chrome = blockChrome(mode);
  const [open, setOpen] = useState(false);
  const Icon = KIND_ICON[block.kind];
  const entries = useMemo(
    () => (block.kind === 'outcome' ? parseChildOutcomeNotice(block.body) : []),
    [block],
  );
  const subtitle = useMemo(() => subtitleOf(block), [block]);
  const failed = entries.some((entry) => entry.status !== 'completed');
  const badgeClass =
    block.kind === 'outcome'
      ? failed
        ? 'bg-error/10 text-error'
        : 'bg-success/10 text-success'
      : 'bg-ink/8 text-ink/70';
  // The aggregate verdict is on the HEADER, not only inside the body: a
  // collapsed card is the normal state, and "did my worker fail" must be
  // answerable without opening it.
  const aggregate = block.kind === 'outcome' && entries.length > 0
    ? failed
      ? STATUS_STYLE.failed
      : STATUS_STYLE.completed
    : null;

  return (
    <div className={`${transcriptGutter(isMobile)} text-[12px] text-ink select-text ${chrome.root}`}>
      {/* The rail is drawn once per TURN by `TurnRail`; this block only places
          its node, exactly as the notice card does. */}
      {mode === 'trace' && <span aria-hidden="true" className={chrome.node} />}
      <div className={chrome.frame || undefined}>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className={`${chrome.header} cursor-pointer hover:bg-ink/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20`}
        >
          <span className={`${chrome.icon} ${badgeClass}`}>
            <Icon size={13} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[12px] font-semibold tracking-tight text-ink">
                {KIND_LABEL[block.kind]}
              </span>
              <span className="rounded bg-ink/5 px-1.5 py-0.2 font-mono text-[10px] text-ink/60">
                Kabmo
              </span>
              {aggregate && (
                <span className={`flex items-center gap-1 rounded px-1.5 py-0.2 font-mono text-[10px] font-semibold uppercase ${aggregate.badge}`}>
                  <aggregate.icon size={10} />
                  {aggregate.label}
                </span>
              )}
            </span>
            {!open && subtitle && (
              <span className="truncate font-mono text-[10.5px] text-ink/45" title={subtitle}>
                {subtitle}
              </span>
            )}
          </span>
          <ChevronDown
            size={14}
            className={`shrink-0 text-ink/35 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <div className={chrome.body}>
            {block.kind === 'outcome' ? (
              <div className="space-y-2">
                {entries.length === 0 ? (
                  <p className="font-mono text-[11px] text-ink/60">No outcome recorded.</p>
                ) : (
                  entries.map((entry) => (
                    <OutcomeEntry
                      key={entry.sessionId}
                      entry={entry}
                      showStatus={entries.length > 1}
                    />
                  ))
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-ink/8 bg-paper p-3 text-[11.5px] leading-relaxed text-ink/85">
                <MarkdownRenderer content={block.body} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
