import { Fragment } from 'preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { ArrowLeft, Bot, Loader2, Lock } from 'lucide-preact';
import type { SubagentInfo } from '@/shared/types';
import { SubagentStatusIcon } from '@/client/components/common/SubagentStatusIcon';
import { ChatMessageItem } from '@/client/components/workspace/chat-timeline/MessageItem';
import { SubagentControls } from '@/client/components/workspace/chat-timeline/SubagentControls';
import { RunFooter } from '@/client/components/workspace/chat-timeline/RunFooter';
import { useSubagentTranscript } from '@/client/hooks/chat/subagent';
import { useModelNames } from '@/client/hooks/models/use-model-names';
import { isNoticeRow } from '@/shared/lib/chat/notice-row';
import { subagentHeaderTitle } from '@/shared/lib/omp/subagent/label';
import { previousNonNoticeIndex, resolveRunFooters, streamingRowIndex } from '@/shared/lib/chat/timeline/run-footer';
import { formatCompactTokens } from '@/shared/lib/format/number';

interface SubagentViewProps {
  sessionId: string | null;
  subagent: SubagentInfo | null;
  onBack: () => void;
  provider?: string;
  providerNames?: Record<string, string>;
  /** Mobile renders the chat's compact footer variant (three-dot menu). */
  isMobile?: boolean;
  className?: string;
}

const STATUS_LABEL: Record<SubagentInfo['status'], string> = {
  started: 'running',
  completed: 'done',
  failed: 'failed',
  aborted: 'aborted',
};

/** Read-only subagent transcript: compact banner, live-growing message list,
 *  and a notice row where the main timeline's composer would be. */
export function SubagentView({ sessionId, subagent, onBack, provider, providerNames, isMobile = false, className = '' }: SubagentViewProps) {
  const { messages, isLoading, status, isActive } = useSubagentTranscript(sessionId, subagent, onBack);
  const modelNames = useModelNames();
  const scrollRef = useRef<HTMLDivElement>(null);

  const effectiveStatus = status?.status ?? subagent?.status ?? 'started';
  const isRunning = effectiveStatus === 'started';

  // Auto-scroll to the newest row as the transcript grows (main timeline parity).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages.length, isRunning]);

  // Boundary footers: a run's footer renders after its last row, so trailing
  // notice rows never separate it from the next user message.
  const { streamingIdx, footers, prevNonNoticeIdx } = useMemo(
    () => ({
      streamingIdx: streamingRowIndex(messages),
      footers: resolveRunFooters(messages, isRunning),
      prevNonNoticeIdx: previousNonNoticeIndex(messages),
    }),
    [messages, isRunning],
  );

  if (!subagent || !isActive) return null;

  const progress = status?.progress ?? subagent.progress;
  const modelName = progress?.resolvedModel ?? subagent.agent;
  const headerTitle = subagentHeaderTitle(status ?? subagent);
  const compactTokens = formatCompactTokens(progress?.tokens);
  const meta = compactTokens ? `${compactTokens} tok` : '';
  const rawTask = status?.task ?? status?.assignment ?? status?.description
    ?? subagent.task ?? subagent.assignment ?? subagent.description;
  const task = rawTask ? rawTask.replace(/\$0(\.00*)?/g, '').trim() : undefined;

  return (
    <div className={`flex flex-col h-full min-h-0 overflow-hidden bg-canvas ${className}`}>
      {/* Banner: back, live status, agent identity, at-a-glance usage */}
      <div className="flex items-center gap-2.5 border-b border-ink/15 bg-paper px-3 py-2 flex-shrink-0">
        <button
          type="button"
          onClick={onBack}
          title="Back to session"
          className="flex items-center justify-center w-7 h-7 rounded-md border border-ink/15 text-ink/70 hover:text-ink hover:bg-ink/5 transition-colors shrink-0 cursor-pointer"
        >
          <ArrowLeft size={14} />
        </button>
        <SubagentStatusIcon status={effectiveStatus} live={isRunning} size={12} />
        <Bot size={13} className="text-ink/60 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[12px] font-semibold text-ink truncate">
              {headerTitle}
            </span>
            <span className="shrink-0 rounded bg-ink/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ink/50">
              {STATUS_LABEL[effectiveStatus]}
            </span>
          </div>
          <p className="truncate text-[11px] text-ink/55 font-sans">
            {task ?? 'Subagent transcript'}
          </p>
        </div>
        {meta && (
          <span className="hidden sm:inline shrink-0 font-mono text-[10px] text-ink/45">
            {meta}
          </span>
        )}
      </div>

      {/* Transcript */}
      <div
        ref={scrollRef}
        className={`flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-overlay-container ${
          isMobile ? 'pl-4 pr-3 py-3 pb-8' : 'p-4 pb-10'
        }`}
      >
        <div className="chat-column">
          {isLoading && messages.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[11px] font-mono text-ink/50">
              <Loader2 size={14} className="animate-spin" />
              <span>Loading transcript…</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="py-12 text-center text-[11.5px] font-mono text-ink/45">
              No transcript messages yet.
            </div>
          ) : (
            messages.map((msg, idx) => {
              const isLoading = isRunning && idx === streamingIdx && msg.role === 'ai';
              const prevRealIdx = prevNonNoticeIdx[idx];
              const prevReal = prevRealIdx >= 0 ? messages[prevRealIdx] : null;
              const isPrevAssistant = Boolean(msg.role !== 'user' && prevReal && prevReal.role !== 'user');
              const footer = footers[idx];

              return (
                <Fragment key={msg.id}>
                  <ChatMessageItem
                    msg={msg}
                    isStreaming={isLoading}
                    isPrevAssistant={isPrevAssistant}
                    userActions={false}
                    isMobile={isMobile}
                    className={isNoticeRow(msg) ? 'mt-3 mb-1' : isPrevAssistant ? 'mt-1' : 'mt-3'}
                  />
                  {footer && (
                    <RunFooter
                      msg={footer.msg}
                      provider={provider}
                      providerNames={providerNames}
                      modelName={modelName}
                      modelNames={modelNames}
                      thinkingLevel={progress?.resolvedThinkingLevel}
                      durationMs={footer.durationMs}
                      answerText={footer.answerText}
                      isMobile={isMobile}
                      showActions={false}
                    />
                  )}
                </Fragment>
              );
            })
          )}
        </div>
      </div>

      {/* Controls in place of the composer. A running subagent can be steered
          or stopped (omp `steer_subagent` / `cancel_subagent`); a finished one
          has nothing left to control, so the strip renders only while running
          and the notice stands in otherwise. */}
      <div className="flex-shrink-0 p-4 pt-1">
        <div className="chat-column">
          {isRunning ? (
            <SubagentControls sessionId={String(sessionId ?? '')} subagentId={subagent.id} running />
          ) : (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-ink/15 bg-paper px-3 py-2 text-[11px] font-mono text-ink/50 select-none">
              <Lock size={11} className="text-ink/45" />
              <span>This subagent has finished</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
