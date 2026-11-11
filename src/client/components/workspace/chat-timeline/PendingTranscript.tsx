/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pending chat's rows: the optimistic turn (`messages`) under the history a
 * FORK inherits (`preview`), in source order.
 *
 * Split from `EmptyWorkspacePrompt` for the per-file ceiling; that file keeps
 * the frame (target row, scroller, dock, composer) and this one owns what is
 * drawn inside the scroller, so the two run-footer rules — one for rows this
 * page mounted, none for the source's own rows — stay in one place.
 */

import { Fragment } from 'preact';
import { useMemo } from 'preact/hooks';
import type { Attachment, ChatMessageData } from '@/shared/types';
import { ChatMessageItem } from '@/client/components/workspace/chat-timeline/MessageItem';
import { RunFooter } from '@/client/components/workspace/chat-timeline/RunFooter';
import { resolveRunFooters, streamingRowIndex } from '@/shared/lib/chat/timeline/run-footer';
import type { ForkPreview } from '@/client/hooks/chat/timeline/fork-preview';

export interface PendingTranscriptProps {
  /** Rows this chat mounted itself (the optimistic turn). */
  messages: ChatMessageData[];
  /** The branch's inherited history; present only for a pending fork. */
  preview?: ForkPreview | null;
  isGenerating: boolean;
  isMobile: boolean;
  provider?: string;
  providerNames?: Record<string, string>;
  modelName?: string;
  modelNames?: Record<string, string>;
  sessionThinkingLevel?: string | null;
  harness?: string;
  onUndo?: (id: string, content?: string) => void;
  onRetry?: (id: string) => void;
  onNewChat?: (content: string, attachments?: Attachment[]) => void;
}

export function PendingTranscript({
  messages,
  preview = null,
  isGenerating,
  isMobile,
  provider,
  providerNames,
  modelName,
  modelNames,
  sessionThinkingLevel,
  harness,
  onUndo,
  onRetry,
  onNewChat,
}: PendingTranscriptProps) {
  const previewMessages = preview?.messages ?? [];
  const { streamingIdx, footers } = useMemo(
    () => ({
      streamingIdx: streamingRowIndex(messages),
      footers: resolveRunFooters(messages, isGenerating),
    }),
    [messages, isGenerating],
  );

  return (
    <div className="chat-column">
      {/* The branch's own history, read-only: these rows belong to the SOURCE
          session, so their Undo / Fork / New-chat actions would act on this
          pending chat and do nothing. No run footer either — the model stamp on
          screen must be the source's, and the fork has not run. */}
      {previewMessages.map((msg, idx) => {
        const prev = previewMessages[idx - 1];
        const isAiFragment = msg.role !== 'user' && prev && prev.role !== 'user';
        return (
          <ChatMessageItem
            key={msg.id}
            msg={msg}
            userActions={false}
            isPrevAssistant={Boolean(prev && prev.role !== 'user')}
            isMobile={isMobile}
            className={isAiFragment ? 'mt-1' : 'mt-8'}
          />
        );
      })}
      {preview?.loading && previewMessages.length === 0 && (
        <div className="mt-8 text-xs text-ink/40">Loading the source transcript…</div>
      )}
      {preview?.error && (
        <div className="mt-8 text-xs text-[var(--theme-error)]">
          Could not read the source transcript: {preview.error}
        </div>
      )}
      {messages.map((msg, idx) => {
        const prev = messages[idx - 1];
        const isLoading = isGenerating && idx === streamingIdx && msg.role === 'ai';
        const isAiFragment = msg.role !== 'user' && prev && prev.role !== 'user';
        const footer = footers[idx];
        return (
          <Fragment key={msg.id}>
            <ChatMessageItem
              msg={msg}
              isStreaming={isLoading}
              onUndo={onUndo}
              onNewChat={onNewChat}
              isMobile={isMobile}
              className={isAiFragment ? 'mt-1' : 'mt-8'}
            />
            {footer && (
              <RunFooter
                msg={footer.msg}
                provider={provider}
                providerNames={providerNames}
                modelName={modelName}
                modelNames={modelNames}
                thinkingLevel={sessionThinkingLevel ?? undefined}
                {...(harness ? { harness } : {})}
                durationMs={footer.durationMs}
                answerText={footer.answerText}
                retryTargetId={footer.runUserId}
                onRetry={onRetry}
                onNewChat={onNewChat}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
