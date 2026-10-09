import { useEffect, useState } from 'preact/hooks';
import type { ReactNode } from 'preact/compat';
import { Bot, Brain, Clock3, Coins, Hourglass, MessageSquarePlus, MoreHorizontal, RotateCcw, X } from 'lucide-preact';
import { CopyButton } from '@/client/components/common/CopyButton';
import { PluginMessageActions } from '@/client/components/workspace/chat-timeline/PluginMessageActions';
import { formatDuration } from '@/shared/lib/chat/duration';
import { providerLabel } from '@/shared/lib/models/provider/label';
import { formatCompactTokens } from '@/shared/lib/format/number';

interface AiMessageFooterProps {
  provider?: string;
  providerNames?: Record<string, string>;
  currentModel: string;
  dateStr?: string;
  durationMs?: number | null;
  usage?: {
    input?: number;
    output?: number;
    totalTokens?: number;
    reasoningTokens?: number;
    cost?: { total?: number; input?: number; output?: number };
  };
  /** Session thinking level (last `thinking_level_change`) shown next to the model. */
  thinkingLevel?: string;
  content: string;
  msgId: string;
  onRetry?: (msgId: string) => void;
  onNewChat?: (content: string) => void;
  isMobile?: boolean;
  /**
   * Whether the row offers Retry / New-chat. Both act on the CHAT (re-run a chat
   * turn, branch a chat session from an answer), so a footer that describes a
   * row the chat does not own — the BTW panel's side answer — turns them off
   * instead of rendering buttons that do nothing.
   */
  showActions?: boolean;
}

export function AiMessageFooter({
  provider,
  providerNames,
  currentModel,
  dateStr,
  durationMs,
  usage,
  content,
  msgId,
  thinkingLevel,
  onRetry,
  onNewChat,
  isMobile = false,
  showActions = true,
}: AiMessageFooterProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const handleRetry = () => {
    setIsMenuOpen(false);
    onRetry?.(msgId);
  };

  const handleNewChat = () => {
    setIsMenuOpen(false);
    onNewChat?.(content);
  };

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setIsMenuOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMenuOpen]);

  const formattedDuration = formatDuration(durationMs ?? 0);
  const totalTok = usage?.totalTokens ?? ((usage?.input ?? 0) + (usage?.output ?? 0));
  const tokensLabel = totalTok > 0 ? `${formatCompactTokens(totalTok) ?? ''} tok` : '';
  const providerText = provider ? providerLabel(provider, providerNames) : '';
  const costLabel = usage?.cost?.total && usage.cost.total > 0
    ? `$${usage.cost.total < 0.01 ? usage.cost.total.toFixed(4) : usage.cost.total.toFixed(3)}`
    : '';
  const metadataItems: Array<{ key: string; content: ReactNode; className?: string; title?: string }> = [];
  if (providerText) metadataItems.push({ key: 'provider', content: providerText });
  if (currentModel) metadataItems.push({ key: 'model', content: currentModel, className: 'font-semibold text-ink min-w-0 truncate shrink' });
  if (thinkingLevel) metadataItems.push({
    key: 'thinking',
    content: (
      <span className="text-ink/60 whitespace-nowrap flex items-center space-x-1" title={`Thinking level: ${thinkingLevel}`}>
        <Brain size={11} className="text-ink/50 flex-shrink-0" />
        <span>{thinkingLevel}</span>
      </span>
    ),
  });
  if (dateStr) metadataItems.push({ key: 'date', content: dateStr });
  if (formattedDuration) {
    metadataItems.push({
      key: 'duration',
      content: (
        <span className="text-ink/60 whitespace-nowrap flex items-center space-x-1" title={`Response time: ${formattedDuration}`}>
          <Hourglass size={11} className="text-ink/50 flex-shrink-0" />
          <span>{formattedDuration}</span>
        </span>
      ),
    });
  }
  if (tokensLabel) {
    metadataItems.push({
      key: 'tokens',
      content: tokensLabel,
      className: 'hidden sm:inline',
      title: usage?.cost?.total ? `${tokensLabel} (${costLabel})` : tokensLabel,
    });
  }
  const titleLabel = [providerText, currentModel || 'Assistant', dateStr || 'Just now', tokensLabel, costLabel]
    .filter(Boolean)
    .join(' • ');

  if (isMobile) {
    return (
      <>
        <div className="w-full flex items-center gap-2 text-[11px] text-ink/60 px-1 pt-0.5 font-mono min-w-0 animate-in fade-in duration-200">
          <div className="flex items-center gap-1.5 min-w-0 truncate" title={titleLabel}>
            <div className="w-4 h-4 rounded flex items-center justify-center bg-ink text-canvas shadow-2xs shrink-0">
              <Bot size={10} />
            </div>
            {providerText && <span className="shrink-0 truncate">{providerText}</span>}
            {providerText && currentModel && <span className="text-ink/35 shrink-0">•</span>}
            {currentModel && <span className="font-semibold text-ink min-w-0 truncate">{currentModel}</span>}
            {currentModel && thinkingLevel && <span className="text-ink/35 shrink-0">•</span>}
            {thinkingLevel && (
              <span className="shrink-0 inline-flex items-center gap-1 text-ink/60" title={`Thinking level: ${thinkingLevel}`}>
                <Brain size={10} className="text-ink/50" />
                <span>{thinkingLevel}</span>
              </span>
            )}
          </div>
          <button
            type="button"
            aria-label="More actions"
            aria-haspopup="dialog"
            aria-expanded={isMenuOpen}
            title="More actions"
            onClick={() => setIsMenuOpen(true)}
            className={`ml-auto shrink-0 rounded-md p-2 transition-colors cursor-pointer ${isMenuOpen ? 'text-ink bg-ink/10' : 'text-ink/50 hover:bg-ink/5 hover:text-ink'}`}
          >
            <MoreHorizontal size={16} />
          </button>
        </div>

        {isMenuOpen && (
          <div
            className="fixed inset-0 z-[70] flex items-end bg-ink/40 backdrop-blur-[1px] animate-in fade-in duration-150"
            role="presentation"
            onClick={() => setIsMenuOpen(false)}
          >
            <div
              className="w-full max-h-[80vh] overflow-y-auto rounded-t-2xl border border-ink/15 bg-paper pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
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
                  onClick={() => setIsMenuOpen(false)}
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
                  onClick={() => setIsMenuOpen(false)}
                />
                {showActions && (
                  <>
                    <button type="button" aria-label="Retry response" onClick={handleRetry} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-ink transition-colors hover:bg-ink/5 cursor-pointer">
                      <RotateCcw size={20} className="shrink-0 text-ink/55" />
                      <span>Retry response</span>
                    </button>
                    <button type="button" aria-label="Start new chat from this answer" onClick={handleNewChat} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-ink transition-colors hover:bg-ink/5 cursor-pointer">
                      <MessageSquarePlus size={20} className="shrink-0 text-ink/55" />
                      <span>Start new chat from this answer</span>
                    </button>
                  </>
                )}
                {/* Plugin contributions sit after the built-ins, in store order;
                    an empty slot adds no row to this sheet. */}
                <PluginMessageActions messageId={msgId} role="ai" text={content} />
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="w-full flex items-center flex-nowrap space-x-2.5 text-[11px] text-ink/60 px-1 pt-0.5 font-mono min-w-0 animate-in fade-in duration-200">
      <div
        className="flex items-center space-x-1.5 border-r border-ink/15 pr-2.5 min-w-0 shrink overflow-hidden"
        title={titleLabel}
      >
        <div className="w-4 h-4 rounded flex items-center justify-center bg-ink text-canvas shadow-2xs shrink-0">
          <Bot size={10} />
        </div>
        {metadataItems.map(({ key, content, className, title }, index) => (
          <span key={key} className={`inline-flex items-center text-ink/60 ${key === 'model' ? 'min-w-0 shrink' : 'shrink-0'} whitespace-nowrap ${className ?? ''}`} title={title}>
            {index > 0 && <span className="text-ink/40 mr-1.5">•</span>}
            {content}
          </span>
        ))}
      </div>

      <div className="flex items-center space-x-1 shrink-0">
        {showActions && (
          <button type="button" className="flex items-center hover:text-ink transition-colors p-1 rounded hover:bg-ink/5 cursor-pointer" title="Re-run / Retry generation" aria-label="Retry response" onClick={handleRetry}>
            <RotateCcw size={12} />
          </button>
        )}
        <CopyButton
          text={content}
          className="flex items-center hover:text-ink transition-colors p-1 rounded hover:bg-ink/5 cursor-pointer"
          iconSize={12}
          title="Copy response"
          ariaLabel="Copy response"
          emptyTitle="Nothing to copy — this run produced no text"
        />
        {showActions && (
          <button type="button" className="flex items-center hover:text-ink transition-colors p-1 rounded hover:bg-ink/5 cursor-pointer" title="New Chat from here" aria-label="Start new chat from this answer" onClick={handleNewChat}>
            <MessageSquarePlus size={12} />
          </button>
        )}
        {/* Plugin contributions sit after the built-ins, in store order; an
            empty slot renders nothing at all, so the strip is unchanged. */}
        <PluginMessageActions messageId={msgId} role="ai" text={content} />
      </div>
    </div>
  );
}
