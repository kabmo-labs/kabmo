/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone's bottom sheet behind the assistant footer.
 *
 * Split out of `AiMessageFooter` at the 350-line ceiling. It is the same sheet
 * the footer always drew: run metadata, Copy, Read aloud, then the chat actions
 * (when the surface owns the chat) and plugin contributions.
 */

import { Clock3, Coins, GitFork, Hourglass, MessageSquarePlus, RotateCcw, X } from 'lucide-preact';
import { CopyButton } from '@/client/components/common/CopyButton';
import { PluginMessageActions } from '@/client/components/workspace/chat-timeline/PluginMessageActions';
import { SpeechButton } from '@/client/components/workspace/chat-timeline/SpeechButton';

export interface AiMessageFooterSheetProps {
  msgId: string;
  content: string;
  speechKey: string;
  showActions: boolean;
  canFork: boolean;
  dateStr?: string;
  formattedDuration?: string;
  tokensLabel: string;
  costLabel: string;
  onRetry: () => void;
  onFork: () => void;
  onNewChat: () => void;
  onClose: () => void;
}

export function AiMessageFooterSheet({
  msgId,
  content,
  speechKey,
  showActions,
  canFork,
  dateStr,
  formattedDuration,
  tokensLabel,
  costLabel,
  onRetry,
  onFork,
  onNewChat,
  onClose,
}: AiMessageFooterSheetProps) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end modal-scrim backdrop-blur-[1px] animate-in fade-in duration-150"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="glass-overlay w-full max-h-[80vh] overflow-y-auto rounded-t-2xl border border-ink/15 bg-paper pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`message-actions-${msgId}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink/10 px-5 py-4">
          <h2 id={`message-actions-${msgId}`} className="text-base font-semibold text-ink">More actions</h2>
          <button
            type="button"
            aria-label="Close more actions"
            title="Close"
            onClick={onClose}
            className="rounded-lg p-2 text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {(dateStr || formattedDuration || tokensLabel) && (
          <div className="flex flex-nowrap items-center gap-3 overflow-hidden whitespace-nowrap border-b border-ink/10 px-5 py-3 text-[11px] text-ink/70">
            {dateStr && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Clock3 size={13} className="shrink-0 text-ink/50" />
                <span className="truncate">{dateStr}</span>
              </span>
            )}
            {formattedDuration && (
              <span className="inline-flex shrink-0 items-center gap-1.5" title="Response time">
                <Hourglass size={13} className="shrink-0 text-ink/50" />
                <span>{formattedDuration}</span>
              </span>
            )}
            {tokensLabel && (
              <span className="inline-flex shrink-0 items-center gap-1.5" title={costLabel ? `${tokensLabel} (${costLabel})` : tokensLabel}>
                <Coins size={13} className="shrink-0 text-ink/50" />
                <span>{tokensLabel}</span>
              </span>
            )}
          </div>
        )}

        <div className="p-2">
          <CopyButton
            text={content}
            className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-ink transition-colors hover:bg-ink/5 cursor-pointer"
            iconSize={20}
            iconClassName="shrink-0 text-ink/55"
            copiedIconClassName="shrink-0 text-success"
            label="Copy answer"
            wrapLabel
            ariaLabel="Copy answer"
            emptyTitle="Nothing to copy — this run produced no text"
            onClick={onClose}
          />
          <SpeechButton
            text={content}
            speechKey={speechKey}
            variant="sheet"
            onStarted={onClose}
          />
          {showActions && (
            <>
              <button type="button" aria-label="Retry response" onClick={onRetry} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-ink transition-colors hover:bg-ink/5 cursor-pointer">
                <RotateCcw size={20} className="shrink-0 text-ink/55" />
                <span>Retry response</span>
              </button>
              {canFork && (
                <button type="button" aria-label="Fork session from this answer" onClick={onFork} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-ink transition-colors hover:bg-ink/5 cursor-pointer">
                  <GitFork size={20} className="shrink-0 text-ink/55" />
                  <span>Fork from this answer</span>
                </button>
              )}
              <button type="button" aria-label="Start new chat from this answer" onClick={onNewChat} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-ink transition-colors hover:bg-ink/5 cursor-pointer">
                <MessageSquarePlus size={20} className="shrink-0 text-ink/55" />
                <span>Start new chat from this answer</span>
              </button>
            </>
          )}
          {/* Plugin contributions sit after the built-ins, in store order; an
              empty slot adds no row to this sheet. */}
          <PluginMessageActions messageId={msgId} role="ai" text={content} />
        </div>
      </div>
    </div>
  );
}
