import { Fragment } from 'preact';
import { useMemo } from 'preact/hooks';
import { memo } from 'preact/compat';

import { ChatMessageItem } from '@/client/components/workspace/chat-timeline/MessageItem';
import { RunFooter } from '@/client/components/workspace/chat-timeline/RunFooter';
import { TurnRail } from '@/client/components/workspace/chat-timeline/TurnRail';
import { useToolRenderMode } from '@/client/hooks/chat/timeline/tool-render-mode';
import { isNoticeRow } from '@/shared/lib/chat/notice-row';
import { previousNonNoticeIndex, resolveRunFooters, streamingRowIndex } from '@/shared/lib/chat/timeline/run-footer';
import { bucketChangesByRun } from '@/shared/lib/chat/timeline/changed-files';
import { runWindowMs } from '@/shared/lib/chat/duration';
import { groupTraceRows } from '@/shared/lib/chat/timeline/trace-groups';
import type { TimelineRowWindow } from '@/client/hooks/chat/timeline/row-window';
import type { Attachment, ChatMessageData, SessionChangeRecord } from '@/shared/types';
import type { ForkAnchorRole } from '@/shared/lib/chat/timeline/fork-anchor';

export interface MessageListProps {
  messages: ChatMessageData[];
  isGenerating: boolean;
  provider?: string;
  providerNames?: Record<string, string>;
  modelName?: string;
  modelNames?: Record<string, string>;
  /** Session thinking level shown in the AI footer. */
  thinkingLevel?: string;
  /** The harness that produced these runs (`omp-rpc`, `opencode`, …), so each
   *  run footer names the agent that wrote it instead of always omp's robot. */
  harness?: string;
  onUndo?: (id: string, content?: string) => void;
  onRetry?: (id: string) => void;
  /** Seeds a new chat from a row. A user row also hands over its attachments. */
  onNewChat?: (content: string, attachments?: Attachment[]) => void;
  /** Branch the session at a user row. */
  onFork?: (msgId: string, role: ForkAnchorRole) => void;
  isMobile?: boolean;
  /**
   * Whether chat-owning actions render: a USER row's Undo / Fork / New-chat,
   * and the run footer's Retry / Fork / New-chat. All of them act on the CHAT
   * (rewind a chat turn, re-run it, branch a session from it), so a renderer
   * that draws rows the chat does not own — the BTW panel's side question and
   * its answer — turns them off instead of showing buttons that do nothing.
   */
  userActions?: boolean;
  /**
   * Which rows are mounted. Absent renders every row, which is what a short
   * list (the BTW panel) wants — see `useTimelineRowWindow` for why the chat's
   * own timeline mounts a window instead.
   */
  rowWindow?: TimelineRowWindow;
  /** Session id the journal diff tabs read from. */
  sessionId?: string;
  /** The session's agent change journal, bucketed into runs here. */
  changeRecords?: SessionChangeRecord[];
}

/**
 * Shared timeline body: the ordered message rows plus the per-run footer
 * (model + duration) placement rules. Desktop and mobile render the exact same
 * rows — only the surrounding scroll container differs.
 *
 * Footer placement: the footer is the run's own boundary row, so it renders
 * after every row the run owns — including notice rows omp wrote at its tail —
 * and therefore immediately before the next user message. A notice-only
 * stretch never gets one.
 */
// Per-row lookups (previous non-notice neighbour, run footers) are built in
// one O(n) pass and memoized on `messages`, so a streaming frame renders in
// O(n) instead of re-scanning the array for every row. `memo` then skips the
// rows entirely when the props are referentially unchanged.
export const MessageList = memo(function MessageList({
  messages,
  isGenerating,
  provider,
  providerNames,
  modelName,
  modelNames,
  thinkingLevel,
  harness,
  onUndo,
  onRetry,
  onNewChat,
  onFork,
  isMobile = false,
  userActions = true,
  rowWindow,
  sessionId,
  changeRecords,
}: MessageListProps) {
  const { streamingIdx, footers, prevNonNoticeIdx, lastUserIdx } = useMemo(() => {
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'user') { lastUser = i; break; }
    }
    return {
      // The streaming AI row is the last non-notice row (see streamingRowIndex).
      streamingIdx: streamingRowIndex(messages),
      // Runs resolve their footer + run duration once here, keyed by the row
      // the footer renders after.
      footers: resolveRunFooters(messages, isGenerating),
      prevNonNoticeIdx: previousNonNoticeIndex(messages),
      // The live run is every row after the last user turn. A thinking block
      // in it must open even when its segment already settled: a warm session
      // delivers the first `message_update` and its `message_end` inside one
      // animation frame, so the block mounts already finalized and the
      // segment's own `isGenerating` is false.
      lastUserIdx: lastUser,
    };
  }, [messages, isGenerating]);

  // The journal's writes bucketed into runs, and each run's wall-clock window
  // (the range a journal diff tab reads). Both are derived from the same
  // `footers` pass, so a run's list and its diff cannot disagree about which
  // run they describe.
  const changedFilesByOwner = useMemo(
    () => bucketChangesByRun(messages, footers, changeRecords ?? []),
    [messages, footers, changeRecords],
  );
  const runWindows = useMemo(() => {
    const windows = new Map<number, { start: number; end: number }>();
    for (const slot of footers) {
      if (!slot) continue;
      const window = runWindowMs(messages, slot.runStartIndex, slot.ownerIndex);
      if (window) windows.set(slot.ownerIndex, window);
    }
    return windows;
  }, [messages, footers]);

  const start = rowWindow ? rowWindow.start : 0;
  const end = rowWindow ? Math.min(rowWindow.end, messages.length) : messages.length;
  const visible = start === 0 && end === messages.length ? messages : messages.slice(start, end);
  const mode = useToolRenderMode();

  // A `trace` rail belongs to the RUN, not to a row and not to one message.
  // omp writes a turn as several rows (thinking + tools, then a notice, then the
  // answer), so a per-row segment broke at every row boundary and a per-message
  // one broke wherever a notice sat in its own row — measured in the browser as
  // three disconnected segments with gaps of 256px and 99px. The rows of one run
  // are therefore grouped under a single `relative` container that draws one
  // line, and each block inside only places its node.
  const groups = useMemo(() => groupTraceRows(messages, start, start + visible.length), [messages, start, visible.length]);

  return (
    <>
      {/* The rows above the window, as one spacer: the scrollbar and every
          geometry read in `scroll.ts` still see the whole session's height,
          while only the rows around the viewport are DOM. */}
      {start > 0 && <div data-timeline-spacer="top" aria-hidden="true" style={{ height: rowWindow?.padTop ?? 0 }} />}
      {groups.map((group) => {
        // The run footer belongs to the run but NOT to its trace: it is a model
        // and duration stamp, not a step. Left inside the rail container it drew
        // the line 58px past the last node (measured), so it renders after the
        // grouped rows instead — outside its row's rect, which is why the
        // sibling below marks which row's measured slot it fills.
        const lastIdx = group.rows[group.rows.length - 1];
        const trailingFooter = footers[lastIdx];
        return (
        <Fragment key={group.key}>
        <div className={group.trace ? 'relative' : undefined} data-trace-group={group.trace || undefined}>
          {group.trace && <TurnRail visible={mode === 'trace'} isMobile={isMobile} />}
          {group.rows.map((idx) => {
            const msg = messages[idx];
            const prev = messages[idx - 1];
            const isLoading = isGenerating && idx === streamingIdx && msg.role === 'ai';
            const isLiveRun = isGenerating && idx > lastUserIdx;
            const isAiFragment = msg.role !== 'user' && prev && prev.role !== 'user' && !isNoticeRow(prev);
            const prevRealIdx = prevNonNoticeIdx[idx];
            const prevReal = prevRealIdx >= 0 ? messages[prevRealIdx] : null;
            const isPrevAssistant = Boolean(msg.role !== 'user' && prevReal && prevReal.role !== 'user');
            const footer = footers[idx];
            // A footer that is NOT the group's trailing one still renders in
            // place — it closes an earlier run's row and the rail already ended.
            const inlineFooter = footer && idx !== lastIdx ? footer : null;
            return (
              // `flow-root` contains the row's own margins, so the measured height
              // is the row PLUS the gap it draws — a plain wrapper would let the
              // margin collapse out and the layout would sit a few px short per row.
              <div key={msg.id} data-row-id={msg.id} style={{ display: 'flow-root' }}>
                <ChatMessageItem
                  msg={msg}
                  isStreaming={isLoading}
                  isLiveRun={isLiveRun}
                  onUndo={onUndo}
                  onNewChat={onNewChat}
                  onFork={onFork}
                  {...(harness ? { harness } : {})}
                  isPrevAssistant={isPrevAssistant}
                  userActions={userActions}
                  isMobile={isMobile}
                  className={isNoticeRow(msg) ? 'mt-3 mb-1' : isAiFragment ? 'mt-1' : 'mt-3'}
                />
                {inlineFooter && (
                  <RunFooter
                    msg={inlineFooter.msg}
                    provider={provider}
                    providerNames={providerNames}
                    modelName={modelName}
                    modelNames={modelNames}
                    thinkingLevel={thinkingLevel}
                    {...(harness ? { harness } : {})}
                    durationMs={inlineFooter.durationMs}
                    answerText={inlineFooter.answerText}
                    retryTargetId={inlineFooter.runUserId}
                    onRetry={onRetry}
                    onNewChat={onNewChat}
                    onFork={onFork}
                    isMobile={isMobile}
                    showActions={userActions}
                    changedFiles={changedFilesByOwner.get(inlineFooter.ownerIndex)}
                    sessionId={sessionId}
                    runWindow={runWindows.get(inlineFooter.ownerIndex)}
                  />
                )}
              </div>
            );
          })}
        </div>
        {trailingFooter && (
          // `data-row-footer-for` is a measurement contract, not decoration:
          // the footer is a SIBLING of the row above (the rail must not run
          // through it), so it sits outside that row's rect — the row window
          // attributes it back by this marker. `flow-root` so the footer's own
          // `mt-2` is inside the rect the window measures.
          <div data-row-footer-for={messages[lastIdx].id} style={{ display: 'flow-root' }}>
            <RunFooter
              msg={trailingFooter.msg}
              provider={provider}
              providerNames={providerNames}
              modelName={modelName}
              modelNames={modelNames}
              thinkingLevel={thinkingLevel}
              {...(harness ? { harness } : {})}
              durationMs={trailingFooter.durationMs}
              answerText={trailingFooter.answerText}
              retryTargetId={trailingFooter.runUserId}
              onRetry={onRetry}
              onNewChat={onNewChat}
              onFork={onFork}
              isMobile={isMobile}
              showActions={userActions}
              changedFiles={changedFilesByOwner.get(trailingFooter.ownerIndex)}
              sessionId={sessionId}
              runWindow={runWindows.get(trailingFooter.ownerIndex)}
            />
          </div>
        )}
        </Fragment>
        );
      })}
      {end < messages.length && <div data-timeline-spacer="bottom" aria-hidden="true" style={{ height: rowWindow?.padBottom ?? 0 }} />}
    </>
  );
});
