import { useMemo, useRef, useState } from 'preact/hooks';
import { AlertCircle, Bell, Bot, CheckCircle2, ChevronDown, Clock, Info, Layers, Target } from 'lucide-preact';
import { isCodeLike } from '@/shared/lib/code/language';
import { useDeferredHighlight } from '@/client/hooks/code/deferred-highlight';
import { useIsTruncated } from '@/client/hooks/ui/text-overflow';
import { parseTaskNotice } from '@/shared/lib/chat/task-result-parser';
import { isReminderTag, stripNoticeTags, unwrapXmlEnvelope } from '@/shared/lib/chat/xml-envelope';
import { parseGoalNotice, type GoalNoticeData } from '@/shared/lib/omp/mode/notice';
import { GoalNotice } from '@/client/components/workspace/chat-timeline/GoalNotice';
import { TaskResultContent } from '@/client/components/workspace/chat-timeline/TaskResultContent';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { transcriptGutter } from '@/shared/lib/chat/timeline/gutter';

const KIND_LABEL: Record<GoalNoticeData['kind'], string> = {
  start: 'Goal started',
  continuation: 'Goal continuation',
  context: 'Goal context',
};

/** Badge label per runtime-notice wrapper, so a loop guard does not read as an
 *  ordinary reminder — the tag omp used IS the kind of event that fired. */
const NOTICE_LABEL: Record<string, string> = {
  'system-reminder': 'System Reminder',
  reminder: 'System Reminder',
  'system-interrupt': 'System Interrupt',
  'system-warning': 'System Warning',
  'system-directive': 'System Directive',
};

/** The card's one visible line when collapsed: a goal card names the objective
 *  (its own badge already says which injection this is), never the raw comment
 *  omp's continuation prompt opens with. */
function goalNoticeTitle(goal: GoalNoticeData): string {
  const first = goal.objective
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean);
  return first ?? KIND_LABEL[goal.kind];
}

interface SystemNoticeProps {
  notice: string;
  /** The `customType` this notice came from, when it has one — the only way to
   *  recognize a goal's opening turn, whose text is the bare objective. */
  source?: string;
  /** Phone layout: the card's frame is the timeline gutter itself. */
  isMobile?: boolean;
}

/** System notice card — handles generic notices, structured <task-result> agent
 *  jobs, and <system-reminder> blocks, all collapsed by default; a goal-mode
 *  injection renders open and has no collapse control (see `forcedOpen`). */
export function SystemNotice({ notice, source, isMobile = false }: SystemNoticeProps) {
  const [userOpen, setUserOpen] = useState(false);

  // 1. Check if notice contains a structured <task-result> block
  const taskNotice = useMemo(() => parseTaskNotice(notice), [notice]);

  // 1b. Goal-mode injections (objective / continuation / context) get their own
  // card: their first line is a raw HTML comment and their body is the internal
  // prompt, neither of which belongs in a "System Notice" subtitle.
  const goalNotice = useMemo(() => parseGoalNotice(notice, source), [notice, source]);

  // 2. Check if notice is a runtime-notice wrapper — `<system-reminder>` (a rule
  //    fired) or `<system-interrupt>` (a loop guard stopped the turn). Both are
  //    transport: the tag and its attributes ARE the notice's identity, and the
  //    body underneath is the instruction omp injected.
  const reminderInfo = useMemo(() => {
    const envelope = unwrapXmlEnvelope(notice);
    const isNoticeLike =
      (envelope !== undefined && isReminderTag(envelope.tag))
      || notice.includes('xd://resolve')
      || notice.includes('`ast_edit` result');
    if (!isNoticeLike) return null;

    // Read the body from the envelope when the tag is one, so a body that quotes
    // markup (a rule's own TypeScript sample) cannot end the strip early. The
    // regex is the fallback for a bare notice text with no wrapper to peel.
    const cleanContent = (envelope?.inner ?? stripNoticeTags(notice)).trim();
    if (!cleanContent) return null;

    // First line for display title, removing backticks for clean title bar display
    const firstLine =
      cleanContent
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find(Boolean) ?? cleanContent;
    const cleanTitle = firstLine.replace(/`([^`]+)`/g, '$1');

    return {
      content: cleanContent,
      title: cleanTitle,
      /** The tag that carried it, so the badge can say which guard fired. */
      tag: envelope?.tag,
      /** `reason="thinking_loop_detected"` — the machine-readable cause. */
      reason: envelope?.attributes.reason,
    };
  }, [notice]);

  // 3. Fallback generic notice parsing (stripping any residual notice tags)
  const genericInfo = useMemo(() => {
    const clean = stripNoticeTags(notice).trim();
    const lines = clean.split(/\r?\n/);
    const firstLine = (lines.find((l) => l.trim()) ?? '').trim();
    const restStart = lines.findIndex((l) => l.trim() === firstLine);
    const rest = lines.slice(restStart + 1).join('\n').trim();
    const isCode = isCodeLike(rest);
    return {
      clean,
      firstLine,
      rest,
      isCode,
    };
  }, [notice]);

  // Deferred and gated: the code branch only renders while the card is open, so
  // a collapsed notice computes nothing and an opened one paints its text first.
  const codeHtml = useDeferredHighlight(
    genericInfo.isCode ? genericInfo.rest || genericInfo.clean : '',
    'javascript',
  );

  const rawTitle = goalNotice
    ? goalNoticeTitle(goalNotice)
    : taskNotice?.intro || reminderInfo?.title || genericInfo.firstLine || notice;
  // The subtitle is clipped by CSS at the card's own width, so the decision to
  // offer an expander is a MEASUREMENT, not a character count: 76 characters
  // fit a desktop timeline and are cut on a phone card. A char threshold left
  // those rows showing an ellipsis with nothing to click (the chevron was
  // dropped with the button disabled). Measured on the exact node that carries
  // `truncate`, so it cannot disagree with the ellipsis the user sees.
  const subtitleRef = useRef<HTMLSpanElement>(null);
  const subtitleClipped = useIsTruncated(subtitleRef, rawTitle);

  // Expandable when the subtitle is visually clipped, or when the body holds
  // something the one-line header cannot show (more lines, a task-result card).
  const isExpandable = useMemo(() => {
    if (taskNotice) return true;
    const clean = stripNoticeTags(notice).trim();
    const lines = clean
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return lines.length > 1 || subtitleClipped;
  }, [taskNotice, notice, subtitleClipped]);

  /**
   * A goal injection is never folded away: it is the objective the turn ran
   * against, and reading it is the whole point of the card. So it renders OPEN,
   * with a header row in place of the toggle — no chevron, nothing to collapse.
   * Every other notice keeps the collapsed-by-default behaviour.
   */
  const forcedOpen = goalNotice !== null;
  const isOpen = forcedOpen || userOpen;
  const canToggle = !forcedOpen && isExpandable;

  const noticeStyle = useMemo(() => {
    if (taskNotice) {
      const isError = taskNotice.status === 'failed' || taskNotice.status === 'error';
      if (isError) {
        return {
          icon: <AlertCircle size={13} />,
          badgeClass: 'bg-error/10 text-error',
          label: 'Task Result',
          isError: true,
        };
      }
      return {
        icon: <CheckCircle2 size={13} />,
        badgeClass: 'bg-success/10 text-success',
        label: 'Task Result',
        isError: false,
      };
    }
    if (goalNotice) {
      return {
        icon: <Target size={13} />,
        badgeClass: 'bg-ink/8 text-ink/70',
        label: KIND_LABEL[goalNotice.kind],
        isError: false,
      };
    }
    if (reminderInfo) {
      return {
        icon: <Bell size={13} />,
        badgeClass: 'bg-warning/10 text-warning',
        label: (reminderInfo.tag && NOTICE_LABEL[reminderInfo.tag]) || 'System Reminder',
        isError: false,
      };
    }
    return {
      icon: <Info size={13} />,
      badgeClass: 'bg-info/10 text-info',
      label: 'System Notice',
      isError: false,
    };
  }, [taskNotice, reminderInfo]);

  const handleToggle = () => {
    if (!canToggle) return;
    setUserOpen((prev) => !prev);
  };

  return (
    <div
      className={`${transcriptGutter(isMobile)} overflow-hidden rounded-xl border border-ink/10 bg-paper text-[12px] text-ink transition-colors ${
        canToggle ? 'hover:border-ink/20' : ''
      } select-text`}
    >
      <button
        type="button"
        onClick={handleToggle}
        disabled={!canToggle}
        aria-expanded={canToggle ? isOpen : undefined}
        className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
          canToggle ? 'cursor-pointer hover:bg-ink/[0.03]' : 'cursor-default'
        } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20`}
      >
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${noticeStyle.badgeClass}`}>
          {noticeStyle.icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[12px] font-semibold tracking-tight text-ink">
              {noticeStyle.label}
            </span>
            {reminderInfo?.reason && (
              <span
                title={reminderInfo.reason}
                className="rounded bg-ink/5 px-1.5 py-0.2 font-mono text-[9px] text-ink/60"
              >
                {reminderInfo.reason}
              </span>
            )}
            {taskNotice?.agent && (
              <span className="flex items-center gap-1 rounded bg-ink/5 px-1.5 py-0.2 font-mono text-[9px] text-ink/60">
                <Bot size={10} />
                {taskNotice.agent}
              </span>
            )}
            {taskNotice?.status && (
              <span
                className={`flex items-center gap-1 rounded px-1.5 py-0.2 font-mono text-[9px] font-semibold uppercase ${
                  noticeStyle.isError ? 'bg-error/10 text-error' : 'bg-success/10 text-success'
                }`}
              >
                {noticeStyle.isError ? <AlertCircle size={10} /> : <CheckCircle2 size={10} />}
                {taskNotice.status}
              </span>
            )}
            {taskNotice?.duration && (
              <span className="flex items-center gap-1 font-mono text-[9px] text-ink/40">
                <Clock size={9} />
                {taskNotice.duration}
              </span>
            )}
            {taskNotice?.meta?.size && (
              <span className="flex items-center gap-1 font-mono text-[9px] text-ink/40">
                <Layers size={9} />
                {taskNotice.meta.size}
              </span>
            )}
          </span>
          {!forcedOpen && !isOpen && rawTitle && (
            <span ref={subtitleRef} className="truncate font-mono text-[10.5px] text-ink/45" title={rawTitle}>
              {rawTitle}
            </span>
          )}
        </span>
        {canToggle && (
          <ChevronDown
            size={14}
            className={`shrink-0 text-ink/35 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {(forcedOpen || (isOpen && isExpandable)) && (
        <div className="border-t border-ink/8 bg-canvas/40 px-3.5 py-2.5">
          {taskNotice ? (
            <TaskResultContent task={taskNotice} />
          ) : goalNotice ? (
            <GoalNotice data={goalNotice} />
          ) : reminderInfo ? (
            <div className="rounded-lg border border-ink/8 bg-paper p-3 text-[11.5px] leading-relaxed text-ink/85">
              <MarkdownRenderer content={reminderInfo.content} />
            </div>
          ) : genericInfo.isCode ? (
            <pre
              className="max-h-56 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-ink/75 scrollbar-overlay-container"
              dangerouslySetInnerHTML={{
                __html: codeHtml,
              }}
            />
          ) : (
            <div className="rounded-lg border border-ink/8 bg-paper p-3 text-[11.5px] leading-relaxed text-ink/85">
              <MarkdownRenderer content={genericInfo.clean || genericInfo.rest} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
