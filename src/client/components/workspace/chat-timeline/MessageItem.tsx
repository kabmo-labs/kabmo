import type { TargetedMouseEvent } from 'preact';
import { useMemo } from 'preact/hooks';
import { memo } from 'preact/compat';
import { AlertCircle, Bot, Info, MessageSquarePlus, Undo2, User } from 'lucide-preact';
import type { Attachment, ChatMessageData } from '@/shared/types';
import { toAttachmentList } from '@/shared/lib/chat/attachments';
import { ThinkingSection } from '@/client/components/workspace/chat-timeline/ThinkingSection';
import { ToolCallingSection } from '@/client/components/workspace/chat-timeline/ToolCallingSection';
import { SystemNotice } from '@/client/components/workspace/chat-timeline/SystemNotice';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { AttachmentChips } from '@/client/components/workspace/chat-timeline/AttachmentChips';
import { CopyButton } from '@/client/components/common/CopyButton';
import { PluginMessageActions } from '@/client/components/workspace/chat-timeline/PluginMessageActions';
import { capitalizeFirstLetter } from '@/shared/lib/chat/capitalize';
import { isNoticeRow, messageAnswerText } from '@/shared/lib/chat/notice-row';
import { formatMessageStamp } from '@/shared/lib/format/time';
import { transcriptBlockPadding, transcriptGutter } from '@/shared/lib/chat/timeline/gutter';
import { traceInset } from '@/shared/lib/chat/timeline/block-chrome';
import { useToolRenderMode } from '@/client/hooks/chat/timeline/tool-render-mode';

interface ChatMessageItemProps {
  msg: ChatMessageData | any;
  isStreaming?: boolean;
  onUndo?: (msgId: string, content?: string) => void;
  /**
   * Start a new chat seeded with this row. A user row passes its attachments
   * too: the prompt it carried is only half the turn — an image or an inlined
   * text file exists nowhere else, and seeding the text alone silently dropped
   * it from the new chat.
   */
  onNewChat?: (content: string, attachments?: Attachment[]) => void;

  /** Extra classes on the root wrapper (e.g. spacing between messages). */
  className?: string;
  /** Whether the message immediately preceding this one was also an assistant message. */
  isPrevAssistant?: boolean;
  /**
   * Whether a user row offers Undo / New-chat. Both act on the CHAT, so a row
   * that is not a chat turn (the BTW panel's question row) turns them off
   * instead of rendering buttons that do nothing.
   */
  userActions?: boolean;
  /**
   * Phone layout. A framed block's margin is then the timeline gutter itself
   * rather than an inset — see `transcriptGutter`.
   */
  isMobile?: boolean;
}

export const ChatMessageItem = memo(function ChatMessageItem({
  msg,
  isStreaming = false,
  onUndo,
  onNewChat,
  className = '',
  isPrevAssistant = false,
  userActions = true,
  isMobile = false,
}: ChatMessageItemProps) {
  const isUser = msg.role === 'user';

  /** A notice row renders as a card. When omp diverted the turn's answer into
   *  `notice` instead, the row is an answer (it kept the turn's own metadata)
   *  and the notice text is the response — see chat/notice-row.ts. */
  const isNotice = isNoticeRow(msg);
  const effectiveContent = isNotice ? msg.content : messageAnswerText(msg);

  /** Stable string references for MarkdownRenderer so its internal
   *  useMemo([content]) holds across parent re-renders (streaming frames
   *  replace the timeline array identity every frame). */
  const userContent = useMemo(() => (typeof effectiveContent === 'string' ? effectiveContent.trim() : effectiveContent), [effectiveContent]);
  const assistantContent = useMemo(() => (typeof effectiveContent === 'string' ? capitalizeFirstLetter(effectiveContent) : effectiveContent), [effectiveContent]);

  /** Content is not worth rendering when it is empty or only punctuation
   *  placeholders ("." / "..." etc.) — chunked assistant turns often carry a
   *  lone dot while the real payload lives in tool calls / thinking. */
  const hasRenderableContent = typeof effectiveContent === 'string' && /[A-Za-z0-9]/.test(effectiveContent);

  const handleNewChat = (e?: TargetedMouseEvent<HTMLElement>) => {
    if (e) e.preventDefault();
    if (!onNewChat) return;
    // Committed rows carry the persisted display fields only (no `File`), which
    // is what the composer and the send path both expect on a replay.
    const attachments = toAttachmentList(msg.attachments);
    onNewChat(msg.content, attachments.length ? attachments : undefined);
  };

  const handleUndo = () => {
    if (onUndo) {
      onUndo(msg.id, msg.content);
    }
  };

  if (isUser) {
    const isAgentAttributed = msg.attribution === 'agent';

    return (
      <div id={msg.id} className={`flex flex-col items-end space-y-1.5 w-full max-w-full ${className}`}>
        {/* User bubble - standardized to text-[13px] with markdown support */}
        <div className={`bg-paper ${transcriptBlockPadding(isMobile)} sm:p-4 rounded-xl border border-ink/15 text-[13px] text-ink shadow-xs max-w-[92%] sm:max-w-[85%] break-words overflow-hidden flex flex-col space-y-2 font-sans select-text ${transcriptGutter(isMobile)}`} style={{ lineHeight: 'var(--markdown-body-line-height)' }}>
          {isAgentAttributed && (
            <div className="flex items-center space-x-1.5 pb-1.5 mb-1 border-b border-ink/10 text-[11px] font-mono text-ink/70">
              <Bot size={12} className="text-ink shrink-0" />
              <span className="font-semibold text-ink">Subagent Assignment</span>
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-ink/5 text-ink/60">Delegated</span>
            </div>
          )}
          <MarkdownRenderer content={userContent} />
          
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
                onClick={handleUndo}
              >
                <Undo2 size={12} />
              </button>
            )}

            {/* Copy Button */}
            <CopyButton
              text={msg.content}
              className="flex items-center hover:text-ink transition-colors p-1 rounded hover:bg-ink/5 cursor-pointer"
              iconSize={12}
              title="Copy prompt"
              ariaLabel="Copy prompt"
              emptyTitle="Nothing to copy — attachment-only prompt"
            />

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
            <PluginMessageActions messageId={String(msg.id)} role="user" text={typeof msg.content === 'string' ? msg.content : ''} />
          </div>
        </div>
      </div>
    );
  }

  // Assistant / AI Message Rendering
  const thinkingData = msg.thinking || (msg.monologue ? { thought: msg.monologue } : undefined);
  const allToolCalls = msg.toolCalls || msg.actions;
  const secondaryToolCalls = msg.actions2;
  const cleanIntent = msg.intent ? capitalizeFirstLetter(msg.intent.replace(/^[.\s]+/, '')) : null;
  const hasToolCalls = Boolean(allToolCalls && allToolCalls.length > 0);

  // `trace` draws a rail in the run's left gutter; content that reserves nothing
  // there would be struck through by it. The inset is the same fact as the
  // rail's own column, so it lives beside `blockChrome` (`traceInset`).
  const mode = useToolRenderMode();
  const textInset = traceInset(mode, isMobile);
  const boxInset = traceInset(mode, isMobile, true);

  return (
    <div 
      id={msg.id} 
      className={`flex flex-col items-start space-y-2 w-full max-w-full transition-all ${
        isStreaming ? 'pb-10 mb-2' : ''
      } ${className}`}
    >
      {/* Main AI Response Container */}
      <div className="w-full space-y-2.5 font-sans leading-relaxed">
        
        {/* System Notice Alert (a notice carrying the answer renders as content below) */}
        {isNotice && <SystemNotice notice={msg.notice} source={msg.noticeSource} isMobile={isMobile} />}

        {/* Thinking / Reasoning Accordion */}
        {thinkingData && (
          <ThinkingSection 
            thinking={thinkingData} 
            defaultExpanded={false}
            showSeparator={isPrevAssistant}
            isMobile={isMobile}
          />
        )}

        {/* Provider / API Error Alert */}
        {msg.error && (
          <div className={`flex items-start space-x-2.5 bg-error/10 border border-error/30 rounded-lg ${boxInset || transcriptGutter(isMobile)} px-3.5 py-2.5 text-[12px] text-ink select-text`}>
            <AlertCircle size={15} className="text-error flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex items-center space-x-2 flex-wrap">
                <span className="font-semibold text-error text-[12px] tracking-tight">
                  {msg.error.status ? `Error ${msg.error.status}` : 'Request Failed'}
                </span>
                {msg.error.stopReason && (
                  <span className="text-[10px] font-mono text-ink/50 bg-ink/5 px-1.5 py-0.5 rounded">
                    {msg.error.stopReason}
                  </span>
                )}
              </div>
              {msg.error.message && (
                <p className="text-ink/80 leading-relaxed text-[12px] font-mono whitespace-pre-wrap break-words">
                  {msg.error.message.split('\n').map((l: string) => l.trim()).filter(Boolean)[0]}
                  {msg.error.message.split('\n').map((l: string) => l.trim()).filter(Boolean).length > 1 && (
                    <span className="relative inline-flex items-center ml-1.5 align-middle group">
                      <Info size={13} className="text-error/70 hover:text-error cursor-pointer transition-colors" />
                      <span className="pointer-events-none absolute z-50 left-1/2 bottom-full mb-1.5 w-72 -translate-x-1/2 rounded-md bg-ink text-canvas p-2.5 text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-words opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-lg">
                        {msg.error.message}
                      </span>
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Main AI Response Content (Rich Markdown with code blocks, tables, lists) rendered before tool calls */}
        {hasRenderableContent && (
          <div className={`text-[13px] text-ink leading-relaxed font-sans bg-transparent px-3 py-1 select-text ${textInset}`}>
            <MarkdownRenderer content={assistantContent} />
          </div>
        )}

        {/* Tool Call Intent (rendered standalone only when there are no tool calls to absorb it as title) */}
        {cleanIntent && !hasToolCalls && (!hasRenderableContent || !msg.content.toLowerCase().includes(msg.intent.toLowerCase().trim())) && (
          <div className={`leading-relaxed font-sans px-3 select-text ${textInset} ${
            hasRenderableContent
              ? 'text-[12px] text-ink/70 py-0.5'
              : 'text-[13px] text-ink py-1'
          }`}>
            {cleanIntent}
          </div>
        )}

        {/* Primary Tool Executions Accordion */}
        {hasToolCalls && (
          <ToolCallingSection 
            tools={allToolCalls}
            defaultExpanded={false}
            isMobile={isMobile}
          />
        )}

        {/* Intermediate Diagnostic Note */}
        {msg.systemNote && (
          <div className={`text-[12px] text-ink leading-relaxed border-l-2 border-ink/30 bg-paper/60 px-3 py-2 rounded-r-md font-mono break-words whitespace-pre-wrap select-text ${boxInset}`}>
            <span className="text-[10px] text-ink/50 uppercase tracking-wider block mb-0.5 font-sans font-semibold">
              Diagnostic Note
            </span>
            {msg.systemNote}
          </div>
        )}

        {/* Secondary Tool Executions */}
        {secondaryToolCalls && secondaryToolCalls.length > 0 && (
          <ToolCallingSection 
            tools={secondaryToolCalls}
            defaultExpanded={true}
            isMobile={isMobile}
          />
        )}

        {/* AI Final Summary / Conclusion Card (Only shown when not streaming) */}
        {!isStreaming && msg.summary && (
          <div className={`text-[12px] text-ink bg-paper border border-ink/15 rounded-lg p-3 space-y-1 select-text font-sans ${boxInset}`}>
            <div className="font-semibold text-ink flex items-center space-x-1.5 text-[12px]">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              <span>Resolution Summary</span>
            </div>
            <p className="text-ink/80 leading-relaxed text-[12px]">{msg.summary}</p>
          </div>
        )}
      </div>
    </div>
  );
});
