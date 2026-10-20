import type { RefObject } from 'preact/compat';
import { ArrowDown } from 'lucide-preact';
import { MessageList } from '@/client/components/workspace/chat-timeline/MessageList';
import { MinimapShortcuts } from '@/client/components/workspace/chat-timeline/MinimapShortcuts';
import { MobileTurnJump } from '@/client/components/workspace/chat-timeline/MobileTurnJump';
import { LoadingOlderIndicator } from '@/client/components/workspace/chat-timeline/SessionSkeleton';
import { OrphanAsks } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/OrphanAsks';
import type { Attachment, ChatMessageData, UserTurnRef } from '@/shared/types';

interface TimelineBodyProps {
  isMobile: boolean;
  /** Every user turn of the session (full history), for the jump rail. */
  userTurns: UserTurnRef[];
  /** A jump is paging history to reach the clicked turn. */
  jumpingTurn: boolean;
  onJumpTurn: (turn: UserTurnRef) => void;
  scrollRef: RefObject<HTMLDivElement>;
  contentRef: (node: HTMLDivElement | null) => void;
  handleScroll: () => void;
  loadingOlder: boolean;
  hasMore: boolean;
  loadOlderError: boolean;
  loadOlder: () => void;
  messages: ChatMessageData[];
  isGenerating: boolean;
  provider?: string;
  providerNames?: Record<string, string>;
  modelName?: string;
  modelNames?: Record<string, string>;
  thinkingLevel?: string;
  onUndo: (id: string, content?: string) => void;
  onRetry: (id: string) => void;
  onNewChat: (content: string, attachments?: Attachment[]) => void;
  showScrollBottom: boolean;
  jumpToBottom: (behavior?: ScrollBehavior) => void;
}

/**
 * Scrollable timeline body: the jump-to-turn control (the rail on desktop,
 * the tap-sized turn list on mobile), the history paging affordance, the
 * ordered message rows, and the scroll-to-bottom button. Split out of
 * ChatTimeline so the parent stays a pure layout shell.
 */
export function TimelineBody({
  isMobile,
  userTurns,
  jumpingTurn,
  onJumpTurn,
  scrollRef,
  contentRef,
  handleScroll,
  loadingOlder,
  hasMore,
  loadOlderError,
  loadOlder,
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
  showScrollBottom,
  jumpToBottom,
}: TimelineBodyProps) {
  return (
    <>
      {/* Jump to a user turn. The rail is desktop's form — one 1px line per
          turn, previewed on hover — so a phone gets the tap-sized list of the
          same turns instead. */}
      {isMobile ? (
        <MobileTurnJump turns={userTurns} jumping={jumpingTurn} onJumpTurn={onJumpTurn} />
      ) : (
        <MinimapShortcuts turns={userTurns} jumping={jumpingTurn} onJumpTurn={onJumpTurn} />
      )}

      {/* Timeline Body */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={`flex-1 scrollbar-overlay-container overscroll-contain scroll-smooth overflow-x-hidden ${
          isMobile ? 'px-3 py-3 pb-8' : 'p-4 pb-10'
        }`}
      >
        <div ref={contentRef} className="mx-auto w-full max-w-[970px]">
          {(loadingOlder || hasMore || loadOlderError) && (
            <div className="pb-1">
              {loadingOlder
                ? <LoadingOlderIndicator />
                : (
                  <button
                    type="button"
                    onClick={loadOlder}
                    className={`block mx-auto px-3 py-1 rounded-full border text-[11px] font-mono transition-colors ${loadOlderError
                      ? 'border-error/40 text-error hover:border-error'
                      : 'border-ink/15 text-ink/50 hover:text-ink hover:border-ink/30'}`}
                  >
                    {loadOlderError ? 'Failed to load — retry' : 'Load earlier messages'}
                  </button>
                )}
            </div>
          )}
          <MessageList
            messages={messages}
            isGenerating={isGenerating}
            provider={provider}
            providerNames={providerNames}
            modelName={modelName}
            modelNames={modelNames}
            thinkingLevel={thinkingLevel}
            onUndo={onUndo}
            onRetry={onRetry}
            onNewChat={onNewChat}
            isMobile={isMobile}
          />
          {/* An ask whose tool card this client cannot see (a subagent's, an
              extension's own dialog, a call outside the loaded window) still
              blocks the agent. It renders HERE, as the last row of the
              conversation, never as a modal over it. */}
          <OrphanAsks />
        </div>
      </div>

      {/* Scroll to bottom button */}
      {showScrollBottom && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-20">
          <button
            onClick={() => jumpToBottom('smooth')}
            className="flex items-center justify-center w-8 h-8 rounded-full border border-ink/20 bg-paper text-ink/60 hover:text-ink hover:bg-ink/5 transition-all shadow-sm"
            title="Scroll to bottom"
          >
            <ArrowDown size={16} />
          </button>
        </div>
      )}
    </>
  );
}
