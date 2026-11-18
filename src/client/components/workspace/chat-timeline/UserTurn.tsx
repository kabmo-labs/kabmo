/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One `role: "user"` row.
 *
 * Split out of `MessageItem` when the orchestration card landed: the row now
 * has two halves — the text Kabmo injected and the text the operator typed —
 * and keeping both in the assistant renderer pushed that file past the repo's
 * ceiling.
 *
 * The split is the point. A delegating message is an orchestration contract
 * PREPENDED to what the person wrote, and a child outcome is a notice with no
 * operator text at all. Drawing either as a bubble made Kabmo's own machinery
 * look like something a human said, so the injected half renders as a card
 * (`OrchestrationNotice`) and only the operator's words keep the bubble.
 */

import { useMemo } from 'preact/hooks';
import { Bot, GitFork, MessageSquarePlus, Undo2, User } from 'lucide-preact';
import type { Attachment, ChatMessageData } from '@/shared/types';
import type { ForkAnchorRole } from '@/shared/lib/chat/timeline/fork-anchor';
import { toAttachmentList } from '@/shared/lib/chat/attachments';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { AttachmentChips } from '@/client/components/workspace/chat-timeline/AttachmentChips';
import { CopyButton } from '@/client/components/common/CopyButton';
import { PluginMessageActions } from '@/client/components/workspace/chat-timeline/PluginMessageActions';
import { OrchestrationNotice } from '@/client/components/workspace/chat-timeline/OrchestrationNotice';
import { formatMessageStamp } from '@/shared/lib/format/time';
import { transcriptBlockPadding, transcriptGutter } from '@/shared/lib/chat/timeline/gutter';
import { parseOrchestrationBlock } from '@/shared/lib/chat/orchestration/notice';

export interface UserTurnProps {
  msg: ChatMessageData | any;
  /** The row's display text, already resolved by the caller. */
  content: unknown;
  isMobile: boolean;
  /** Whether this row offers Undo / New-chat (a chat turn, not a BTW question). */
  userActions: boolean;
  canFork: boolean;
  className: string;
  onUndo?: (msgId: string, content?: string) => void;
  onNewChat?: (content: string, attachments?: Attachment[]) => void;
  onFork?: (msgId: string, role: ForkAnchorRole) => void;
}

export function UserTurn({
  msg,
  content,
  isMobile,
  userActions,
  canFork,
  className,
  onUndo,
  onNewChat,
  onFork,
}: UserTurnProps) {
  const isAgentAttributed = msg.attribution === 'agent';
  const raw = typeof content === 'string' ? content : '';
  const orchestration = useMemo(() => parseOrchestrationBlock(raw), [raw]);
  // What the operator actually wrote. For a delegating turn that is the text
  // after the contract; for a notice it is nothing, and the row is the card.
  const operatorText = orchestration ? orchestration.rest : raw;
  const showBubble = !orchestration || operatorText.length > 0;
  const displayText = useMemo(() => operatorText.trim(), [operatorText]);

  const handleNewChat = (e?: Event) => {
    if (e) e.preventDefault();
    if (!onNewChat) return;
    // Committed rows carry the persisted display fields only (no `File`), which
    // is what the composer and the send path both expect on a replay.
    const attachments = toAttachmentList(msg.attachments);
    onNewChat(displayText, attachments.length ? attachments : undefined);
  };

  return (
    <div id={msg.id} className={`flex flex-col space-y-1.5 w-full max-w-full ${className}`}>
      {orchestration && <OrchestrationNotice block={orchestration} isMobile={isMobile} />}

      {showBubble && (
        <div className="flex flex-col items-end space-y-1.5 w-full max-w-full">
          {/* User bubble - standardized to text-[13px] with markdown support */}
          <div className={`bg-paper ${transcriptBlockPadding(isMobile)} sm:p-4 rounded-xl border border-ink/15 text-[13px] text-ink shadow-xs max-w-[92%] sm:max-w-[85%] break-words overflow-hidden flex flex-col space-y-2 font-sans select-text ${transcriptGutter(isMobile)}`} style={{ lineHeight: 'var(--markdown-body-line-height)' }}>
            {isAgentAttributed && (
              <div className="flex items-center space-x-1.5 pb-1.5 mb-1 border-b border-ink/10 text-[11px] font-mono text-ink/70">
                <Bot size={12} className="text-ink shrink-0" />
                <span className="font-semibold text-ink">Subagent Assignment</span>
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-ink/5 text-ink/60">Delegated</span>
              </div>
            )}
            <MarkdownRenderer content={displayText} />

            <AttachmentChips
              attachments={msg.attachments || []}
              onOpenFile={(att: { name?: string; content?: string }) => {
                window.dispatchEvent(new CustomEvent('omp:open-file', {
                  detail: { path: att.name ?? 'attachment', content: att.content }
                }));
              }}
            />
          </div>

          {/* User Metadata & Toolbar (Undo on the left of Copy) */}
          <div className="flex items-center space-x-2.5 text-[11px] text-ink/60 px-1 font-mono">
            <div className="flex items-center space-x-1.5 border-r border-ink/15 pr-2.5">
              {isAgentAttributed ? (
                <>
                  <Bot size={11} className="text-ink/70 shrink-0" />
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-ink/60">Agent</span>
                </>
              ) : (
                <User size={11} className="text-ink/70 shrink-0" />
              )}
              {formatMessageStamp(msg) && <span>{formatMessageStamp(msg)}</span>}
            </div>

            <div className="flex items-center space-x-1">
              {/* Undo Button (to the left of copy button) */}
              {userActions && (
                <button
                  type="button"
                  className="flex items-center hover:text-ink transition-colors p-1 rounded hover:bg-ink/5 cursor-pointer"
                  title="Undo / Edit message"
                  aria-label="Undo this message"
                  onClick={() => onUndo?.(msg.id, displayText)}
                >
                  <Undo2 size={12} />
                </button>
              )}

              {/* Copy Button — the operator's words, never the injected contract. */}
              <CopyButton
                text={displayText}
                className="flex items-center hover:text-ink transition-colors p-1 rounded hover:bg-ink/5 cursor-pointer"
                iconSize={12}
                title="Copy prompt"
                ariaLabel="Copy prompt"
                emptyTitle="Nothing to copy — attachment-only prompt"
              />

              {/* Fork Button — branches the session at this row, leaving the
                  source untouched. Separate from New Chat: a fork carries the
                  history, a new chat does not. */}
              {userActions && canFork && (
                <button
                  type="button"
                  className="flex items-center hover:text-ink transition-colors p-1 rounded hover:bg-ink/5 cursor-pointer"
                  title="Fork from here"
                  aria-label="Fork this session from this message"
                  onClick={(e) => {
                    e.preventDefault();
                    onFork?.(msg.id, 'user');
                  }}
                >
                  <GitFork size={12} />
                </button>
              )}

              {/* New Chat Button */}
              {userActions && (
                <button
                  type="button"
                  className="flex items-center hover:text-ink transition-colors p-1 rounded hover:bg-ink/5 cursor-pointer"
                  title="New Chat from here"
                  aria-label="Start a new chat from this message"
                  onClick={handleNewChat}
                >
                  <MessageSquarePlus size={12} />
                </button>
              )}

              {/* Plugin contributions, in store order. The empty slot renders
                  nothing, so a Kabmo with no plugins keeps this strip intact. */}
              <PluginMessageActions messageId={String(msg.id)} role="user" text={displayText} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
