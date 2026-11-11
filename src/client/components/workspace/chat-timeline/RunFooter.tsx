import type { Attachment, ChatMessageData } from '@/shared/types';
import { AiMessageFooter } from '@/client/components/workspace/chat-timeline/AiMessageFooter';
import { messageAnswerText } from '@/shared/lib/chat/notice-row';
import { formatMessageStamp } from '@/shared/lib/format/time';
import type { ForkAnchorRole } from '@/shared/lib/chat/timeline/fork-anchor';

interface RunFooterProps {
  /** The run's last real AI message (`RunFooterSlot.msg`). */
  msg: ChatMessageData;
  /** Session-level provider, used when the turn recorded none. */
  provider?: string;
  providerNames?: Record<string, string>;
  modelName?: string;
  /** id → display-name map from the model catalog. */
  modelNames?: Record<string, string>;
  /** Session thinking level, used when the turn recorded none. */
  thinkingLevel?: string;
  /** The harness that produced this run (`omp-rpc`, `opencode`, …). */
  harness?: string;
  durationMs?: number | null;
  /**
   * The run's whole answer (`RunFooterSlot.answerText`) — what Copy and
   * "new chat from this answer" act on. Falls back to the owner row's own text
   * for call sites that only have a message.
   */
  answerText?: string;
  /**
   * The user row that opened the run (`RunFooterSlot.runUserId`): the turn
   * Retry re-runs. The owner row is the run's LAST row, so handing its id to
   * Retry made the button a silent no-op on every multi-row run.
   */
  retryTargetId?: string;
  onRetry?: (msgId: string) => void;
  onNewChat?: (content: string, attachments?: Attachment[]) => void;
  /**
   * Branch the session from this answer. The anchor is the run's owner row
   * (`msg.id`), never `retryTargetId`: the opening user row would fork BEFORE
   * the answer, while the footer sits under it.
   */
  onFork?: (msgId: string, role: ForkAnchorRole) => void;
  /** Mobile uses a compact provider/model footer with a bottom-sheet menu. */
  isMobile?: boolean;
  /**
   * Whether the footer offers Retry / Fork / New-chat. All of them act on the
   * CHAT, so a footer describing a row the chat does not own (the BTW panel's
   * side answer) turns them off rather than rendering dead buttons.
   */
  showActions?: boolean;
}

/**
 * Boundary footer of an AI response run: the timeline renders it as the run's
 * own row — after every row the run owns, immediately before the next user
 * message — never inside the answer bubble. The slot's AI message supplies the
 * turn's model/usage; the answer text and retry target come from the run.
 */
export function RunFooter({
  msg,
  provider,
  providerNames,
  modelName,
  modelNames,
  thinkingLevel,
  harness,
  durationMs,
  answerText,
  retryTargetId,
  onRetry,
  onNewChat,
  onFork,
  isMobile = false,
  showActions = true,
}: RunFooterProps) {
  return (
    <div className="mt-2">
      <AiMessageFooter
        provider={msg.provider || provider}
        providerNames={providerNames}
        currentModel={(msg.model ? (modelNames?.[msg.model] ?? msg.model) : '') || modelName || ''}
        thinkingLevel={msg.thinkingLevel ?? thinkingLevel}
        harness={harness}
        dateStr={formatMessageStamp(msg)}
        durationMs={durationMs ?? msg.durationMs}
        usage={msg.usage}
        content={answerText ?? messageAnswerText(msg)}
        msgId={retryTargetId || msg.id}
        onRetry={onRetry}
        onNewChat={onNewChat}
        forkTargetId={msg.id}
        onFork={onFork}
        isMobile={isMobile}
        showActions={showActions}
      />
    </div>
  );
}
