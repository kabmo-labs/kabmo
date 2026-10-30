import type { Dispatch, SetStateAction } from 'preact/compat';
import { ChatInput } from '@/client/components/workspace/chat-timeline/chat-input/index';
import { BtwForm } from '@/client/components/workspace/btw-panel/index';
import { useBtwMode } from '@/client/hooks/chat/btw/mode';
import { GeneratingIndicator } from '@/client/components/workspace/chat-timeline/GeneratingIndicator';
import { QueueList } from '@/client/components/workspace/chat-timeline/QueueList';
import type { Attachment, QueuedMessage } from '@/shared/types';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import type { ComposerModes } from '@/client/components/workspace/chat-timeline/chat-input/modes-props';
import { PluginComposerBanners } from '@/client/components/workspace/chat-timeline/chat-input/PluginComposerSlots';

interface ComposerDockProps {
  isMobile: boolean;
  /** Kabmo session the side-question panel scopes to. */
  sessionId: string | null;
  isGenerating: boolean;
  /**
   * Whether the docked generating indicator renders. Wider than
   * `isGenerating`: it also counts the server-tracked `stream` status the
   * sidebar spinner is drawn from, so a run this client did not start (a
   * second tab, another Kabmo instance) still shows as generating here.
   * Reaches the composer as its chat-level running flag as well: the goal strip
   * and the Stop button describe the RUN, not this draft, and reading
   * `isGenerating` alone hid Stop for every run this page did not start.
   */
  showGeneratingIndicator: boolean;
  modelName?: string;
  generatingVerb: string;
  provider?: string;
  providerNames?: Record<string, string>;
  messageQueue: QueuedMessage[];
  onRemoveQueueItem: (id: string) => void;
  onReorderQueue: (orderedIds: string[]) => void;
  onEditQueueItem: (item: QueuedMessage) => void;
  onSendNowQueueItem: (item: QueuedMessage) => void;
  inputValue: string;
  setInputValue: Dispatch<SetStateAction<string>>;
  rootPath: string | null;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  onSend: (attachments: Attachment[], options?: { steering?: boolean }) => void;
  onStop: () => void;
  appSettings: Record<string, unknown>;
  onThinkingLevelChange: (level: string) => void;
  onModelChange: (provider: string, modelId: string) => void;
  accessMode: ApprovalMode;
  onAccessModeChange: (mode: ApprovalMode) => void;
  /** Plan/goal mode slice; omitted by a composer with no chat turn of its own. */
  modes?: ComposerModes;
  composerModelRef: { current: { provider: string; modelId: string; thinkingLevel: string } | null };
  deferredComposerPickRef: { current: { provider?: string; modelId?: string; thinkingLevel?: string } | null };
  sessionModel: { provider: string; modelId: string } | null;
  sessionThinkingLevel?: string | null;
  variant: 'desktop' | 'mobile';
  /**
   * The phone reader is scrolled back through the transcript, so the composer
   * may give its height back (`ChatInput.shrinkWhileReading`). Derived from the
   * timeline's own scroll geometry — the same signal that draws the
   * scroll-to-bottom affordance.
   */
  shrinkWhileReading?: boolean;
  /**
   * The chat has no turns yet. Only the `stage` composer style reads it, and it
   * only ever changes the card's frame — never which controls exist.
   */
  hero?: boolean;
}

/**
 * Docked composer footer: the generating indicator, the queued/steering
 * delivery lists, and the input itself. Split out of ChatTimeline so the
 * parent stays a pure layout shell.
 */
export function ComposerDock({
  isMobile,
  sessionId,
  isGenerating,
  showGeneratingIndicator,
  modelName,
  generatingVerb,
  provider,
  providerNames,
  messageQueue,
  onRemoveQueueItem,
  onReorderQueue,
  onEditQueueItem,
  onSendNowQueueItem,
  inputValue,
  setInputValue,
  rootPath,
  attachments,
  setAttachments,
  onSend,
  onStop,
  appSettings,
  onThinkingLevelChange,
  onModelChange,
  accessMode,
  onAccessModeChange,
  modes,
  composerModelRef,
  deferredComposerPickRef,
  sessionModel,
  sessionThinkingLevel,
  variant,
  shrinkWhileReading = false,
  hero = false,
}: ComposerDockProps) {
  // Side questions take over the composer entirely: the chat's own input is
  // hidden while the form is open, so a stray Enter cannot send to the wrong
  // conversation.
  const btw = useBtwMode(sessionId);

  return (
    <div
      className={`bg-transparent border-t-0 flex-shrink-0 space-y-2 ${isMobile ? 'px-3 pt-1' : 'p-4 pt-1'}`}
      style={isMobile ? { paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' } : undefined}
    >
      {/* `relative` keeps the queue/indicator stack anchored above the input
          while the side-question form takes the composer's place. */}
      <div className="chat-column relative">
        {/* Plugin banner strip: above the input, in the chat's own composer.
            An empty slot renders nothing, so a Kabmo with no plugins keeps
            this dock byte-identical. */}
        <PluginComposerBanners />
        {showGeneratingIndicator && (
          <GeneratingIndicator
            modelName={modelName}
            generatingVerb={generatingVerb}
            provider={provider}
            providerNames={providerNames}
          />
        )}
        <QueueList
          queue={messageQueue}
          onRemove={onRemoveQueueItem}
          onReorder={onReorderQueue}
          onEdit={onEditQueueItem}
          onSendNow={onSendNowQueueItem}
        />
        {btw.open ? (
          <BtwForm
            mode={btw}
            appSettings={appSettings}
            composerModelRef={composerModelRef}
            rootPath={rootPath}
            variant={variant}
            modelName={modelName}
            provider={provider}
            providerNames={providerNames}
          />
        ) : (
          <ChatInput
            value={inputValue}
            onChange={setInputValue}
            sessionId={sessionId}
            rootPath={rootPath}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            onSend={onSend}
            isGenerating={isGenerating}
            chatRunning={showGeneratingIndicator}
            onStop={onStop}
            appSettings={appSettings}
            onThinkingLevelChange={onThinkingLevelChange}
            onModelChange={onModelChange}
            accessMode={accessMode}
            onAccessModeChange={onAccessModeChange}
            modes={modes}
            composerModelRef={composerModelRef}
            deferredComposerPickRef={deferredComposerPickRef}
            sessionModel={sessionModel}
            sessionThinkingLevel={sessionThinkingLevel}
            variant={variant}
            expandable
            hero={hero}
            shrinkWhileReading={shrinkWhileReading}
          />
        )}
      </div>
    </div>
  );
}
