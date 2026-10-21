import { Fragment } from 'preact';
import { useMemo } from 'preact/hooks';
import { memo } from 'preact/compat';

import { ChatMessageItem } from '@/client/components/workspace/chat-timeline/MessageItem';
import { RunFooter } from '@/client/components/workspace/chat-timeline/RunFooter';
import { isNoticeRow } from '@/shared/lib/chat/notice-row';
import { previousNonNoticeIndex, resolveRunFooters, streamingRowIndex } from '@/shared/lib/chat/timeline/run-footer';
import type { Attachment, ChatMessageData } from '@/shared/types';

export interface MessageListProps {
  messages: ChatMessageData[];
  isGenerating: boolean;
  provider?: string;
  providerNames?: Record<string, string>;
  modelName?: string;
  modelNames?: Record<string, string>;
  /** Session thinking level shown in the AI footer. */
  thinkingLevel?: string;
  onUndo?: (id: string, content?: string) => void;
  onRetry?: (id: string) => void;
  /** Seeds a new chat from a row. A user row also hands over its attachments. */
  onNewChat?: (content: string, attachments?: Attachment[]) => void;
  isMobile?: boolean;
  /**
   * Whether chat-owning actions render: a USER row's Undo / New-chat, and the
   * run footer's Retry / New-chat. All of them act on the CHAT (rewind a chat
   * turn, re-run it, branch a session from it), so a renderer that draws rows
   * the chat does not own — the BTW panel's side question and its answer — turns
   * them off instead of showing buttons that do nothing.
   */
  userActions?: boolean;
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
  onUndo,
  onRetry,
  onNewChat,
  isMobile = false,
  userActions = true,
}: MessageListProps) {
  const { streamingIdx, footers, prevNonNoticeIdx } = useMemo(() => {
    return {
      // The streaming AI row is the last non-notice row (see streamingRowIndex).
      streamingIdx: streamingRowIndex(messages),
      // Runs resolve their footer + run duration once here, keyed by the row
      // the footer renders after.
      footers: resolveRunFooters(messages, isGenerating),
      prevNonNoticeIdx: previousNonNoticeIndex(messages),
    };
  }, [messages, isGenerating]);

  return (
    <>
      {messages.map((msg, idx) => {
        const prev = messages[idx - 1];
        const isLoading = isGenerating && idx === streamingIdx && msg.role === 'ai';
        const isAiFragment = msg.role !== 'user' && prev && prev.role !== 'user' && !isNoticeRow(prev);
        const prevRealIdx = prevNonNoticeIdx[idx];
        const prevReal = prevRealIdx >= 0 ? messages[prevRealIdx] : null;
        const isPrevAssistant = Boolean(msg.role !== 'user' && prevReal && prevReal.role !== 'user');
        const footer = footers[idx];
        return (
          <Fragment key={msg.id}>
            <ChatMessageItem
              msg={msg}
              isStreaming={isLoading}
              onUndo={onUndo}
              onNewChat={onNewChat}
              isPrevAssistant={isPrevAssistant}
              userActions={userActions}
              isMobile={isMobile}
              className={isNoticeRow(msg) ? 'mt-3 mb-1' : isAiFragment ? 'mt-1' : 'mt-3'}
            />
            {footer && (
              <RunFooter
                msg={footer.msg}
                provider={provider}
                providerNames={providerNames}
                modelName={modelName}
                modelNames={modelNames}
                thinkingLevel={thinkingLevel}
                durationMs={footer.durationMs}
                answerText={footer.answerText}
                retryTargetId={footer.runUserId}
                onRetry={onRetry}
                onNewChat={onNewChat}
                isMobile={isMobile}
                showActions={userActions}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
});
