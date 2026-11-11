import type { Dispatch, SetStateAction } from 'preact/compat';
import { ChatInput } from '@/client/components/workspace/chat-timeline/chat-input/index';
import { BtwForm } from '@/client/components/workspace/btw-panel/index';
import { useBtwMode } from '@/client/hooks/chat/btw/mode';
import { ComposerDockFrame } from '@/client/components/workspace/chat-timeline/ComposerDockFrame';
import { GeneratingIndicator } from '@/client/components/workspace/chat-timeline/GeneratingIndicator';
import { QueueList } from '@/client/components/workspace/chat-timeline/QueueList';
import type { Attachment, QueuedMessage } from '@/shared/types';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import type { ComposerModes } from '@/client/components/workspace/chat-timeline/chat-input/modes-props';
import type { WaitingCandidate } from '@/client/components/workspace/chat-timeline/chat-input/WaitingDependencyPicker';
import { PluginComposerBanners } from '@/client/components/workspace/chat-timeline/chat-input/PluginComposerSlots';
import { Hourglass } from 'lucide-preact';

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
  /** Which harness runs this chat. Absent before the first spawn. */
  harness?: string;
  /** False once the chat has a transcript: the harness tab strip explains that
   *  switching needs a new chat rather than changing the transport silently. */
  harnessEditable?: boolean;
  onSelectHarness?: (harness: string) => void;
  /** "Wait for session" for the next prompt, mounted in the toolbar. */
  waiting?: {
    value: WaitingCandidate | null;
    candidates: WaitingCandidate[];
    onChange: (candidate: WaitingCandidate | null) => void;
  };
  /** A held prompt for THIS chat: the composer waits until it is released. */
  heldWait?: { title: string | null } | null;
  onCancelWait?: () => void;
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
  harness,
  harnessEditable = true,
  onSelectHarness,
  waiting,
  heldWait = null,
  onCancelWait,
}: ComposerDockProps) {
  // Side questions take over the composer entirely: the chat's own input is
  // hidden while the form is open, so a stray Enter cannot send to the wrong
  // conversation.
  const btw = useBtwMode(sessionId);

  return (
    <ComposerDockFrame isMobile={isMobile}>
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
          {...(harness ? { harness } : {})}
        />
      )}
      {heldWait && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-ink/15 bg-ink/[0.03] px-3 py-2 text-xs text-ink/70">
          <Hourglass size={12} className="shrink-0 animate-pulse text-ink/60" />
          <span className="min-w-0 flex-1 truncate">
            Waiting for {heldWait.title ?? 'another session'} to finish before this prompt is sent.
          </span>
          {onCancelWait && (
            <button
              type="button"
              data-testid="cancel-held-prompt"
              onClick={onCancelWait}
              className="shrink-0 rounded border border-ink/20 px-2 py-0.5 text-[11px] text-ink/70 hover:bg-ink/5 hover:text-ink cursor-pointer"
            >
              Cancel
            </button>
          )}
        </div>
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
          disabled={Boolean(heldWait)}
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
          {...(waiting ? { waiting } : {})}
          sessionModel={sessionModel}
          sessionThinkingLevel={sessionThinkingLevel}
          harness={harness}
          harnessEditable={harnessEditable}
          onSelectHarness={onSelectHarness}
          variant={variant}
          expandable
          hero={hero}
          shrinkWhileReading={shrinkWhileReading}
        />
      )}
    </ComposerDockFrame>
  );
}
