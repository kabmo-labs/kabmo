import { Loader2, Mic, MicOff, Send, Square } from 'lucide-preact';
import type { AIModelOption } from '@/shared/types';
import { ModelDropdown } from '@/client/components/workspace/model-dropdown/index';
import { ThinkingLevelDropdown } from '@/client/components/workspace/chat-timeline/chat-input/ThinkingLevelDropdown';
import { AccessDropdown } from '@/client/components/workspace/chat-timeline/chat-input/AccessDropdown';
import { ModeToggles } from '@/client/components/workspace/chat-timeline/chat-input/ModeToggles';
import { PluginComposerActions } from '@/client/components/workspace/chat-timeline/chat-input/PluginComposerSlots';
import type { ComposerModes } from '@/client/components/workspace/chat-timeline/chat-input/modes-props';
import { DEFAULT_APPROVAL_MODE, type ApprovalMode } from '@/shared/lib/omp/config/access-mode';

export interface ComposerToolbarProps {
  isMobile: boolean;
  /** Null until `/api/models` resolves — the dropdown renders its own placeholder. */
  selectedModel: AIModelOption | null;
  onSelectModel: (model: AIModelOption) => void;
  thinkingLevels: string[];
  currentThinking: string;
  onSelectThinking: (level: string) => void;
  /** Thinking pill inside the model dropdown; mirrors onSelectThinking so both
   *  entry points reach the live session. */
  onThinkingLevelChange?: (level: string) => void;
  isGenerating: boolean;
  /**
   * The CHAT-level "a run is in flight" flag (`timelineRunning`) — the
   * server-tracked `stream` status OR this client's own run. The Stop button
   * asks THIS: a run this page did not start (another tab, a scheduled task,
   * the goal driver's continuation, a page that reattached to the stream)
   * still has to be stoppable, and the sidebar spinner already says it is
   * running. Reading `isGenerating` alone hid Stop for exactly those runs.
   * Falls back to `isGenerating` for a composer with no chat turn (the New
   * Chat modal, the side-question form).
   */
  chatRunning?: boolean;
  onStop?: () => void;
  onSend: () => void;
  /** Send is blocked while no workspace context is selected or nothing is typed. */
  sendDisabled: boolean;
  accessMode?: ApprovalMode;
  onSelectAccess?: (mode: ApprovalMode) => void;
  /** Which selectors render; all true for the chat, all false for a side question. */
  showModel?: boolean;
  showThinking?: boolean;
  showAccess?: boolean;
  /** Plan/Goal toggles. Omitted by a composer that does not own a chat turn. */
  modes?: ComposerModes;
  /** Opens the Goal modal, owned by `ChatInput`. */
  onOpenGoal?: () => void;
  /** Voice input controls. */
  voiceSupported?: boolean;
  voiceListening?: boolean;
  /** True from release until the transcript lands; the button shows a spinner. */
  voiceBusy?: boolean;
  onVoiceToggle?: () => void;
  /** The draft, handed to a plugin `composerAction` at render time. */
  text?: string;
}

/**
 * Bottom config row of the composer: model + thinking + access + plan/goal
 * selectors on the left, Stop/Send on the right.
 *
 * The row is a CONTAINER (`@container`), not a viewport breakpoint: it lives in
 * a chat panel that can be 320px wide on a 1440px screen, so `sm:` would keep
 * every label on and overflow the panel. Each control hides its label below
 * `@[420px]` and keeps its icon.
 *
 * Stop never displaces Send on mobile: a touch keyboard has no Enter-to-send
 * (see ComposerTextarea `variant`), so hiding Send mid-run would leave no way to
 * submit a follow-up — queued or steering.
 */
export function ComposerToolbar({
  isMobile,
  selectedModel,
  onSelectModel,
  thinkingLevels,
  currentThinking,
  onSelectThinking,
  onThinkingLevelChange,
  isGenerating,
  chatRunning,
  onStop,
  onSend,
  sendDisabled,
  accessMode = DEFAULT_APPROVAL_MODE,
  onSelectAccess,
  showModel = true,
  showThinking = true,
  showAccess = true,
  modes,
  onOpenGoal,
  voiceSupported,
  voiceListening,
  voiceBusy,
  onVoiceToggle,
  text = '',
}: ComposerToolbarProps) {
  const chatInFlight = chatRunning ?? isGenerating;
  const showStop = chatInFlight && (isMobile ? Boolean(onStop) : true);

  return (
    <div
      // No separator and no tinted strip: the composer is one card, so its
      // toolbar shares the card's surface. `rounded-b-[inherit]` still follows
      // the frame (the phone's stretched composer is `rounded-none`).
      // `py-1.5`, and the phone's controls are `w-8 h-8`: measured on a Pixel 7,
      // the row was 56px tall for a 40px button, which made the composer's
      // footer read as a second, heavier bar under the draft. A 32px target
      // still clears the 28px minimum for a touch control while bringing the
      // row to 44px — the same height as the compact textarea above it.
      className="composer-toolbar-row @container flex items-center justify-between rounded-b-[inherit] px-3 py-1.5"
    >
      <div className={`flex items-center min-w-0 ${isMobile ? 'space-x-1' : 'space-x-2'}`}>
        {showModel && (
          <ModelDropdown
            selectedModel={selectedModel ?? undefined}
            onSelectModel={onSelectModel}
            onThinkingLevelChange={onThinkingLevelChange}
            className="min-w-0"
          />
        )}

        {showModel && showThinking && <div className="w-[1px] h-3 bg-ink/10" />}

        {showThinking && (
          <ThinkingLevelDropdown
            thinkingLevels={thinkingLevels}
            currentThinking={currentThinking}
            onSelect={onSelectThinking}
          />
        )}

        {(showModel || showThinking) && showAccess && <div className="w-[1px] h-3 bg-ink/10" />}

        {showAccess && onSelectAccess && <AccessDropdown value={accessMode} onSelect={onSelectAccess} />}

        {/* On a phone the mode toggles live in the row above (the attachment
            row), because this one is a single line already filled by the
            model/thinking/access cluster plus voice+send: a third group here
            pushed voice under the model label. On desktop there is room. */}
        {!isMobile && showAccess && modes && onOpenGoal && (
          <>
            <div className="w-[1px] h-3 bg-ink/10" />
            <ModeToggles
              plan={modes.plan}
              goal={modes.goalOpen}
              goalRecord={modes.goalRecord}
              pending={modes.pending}
              onTogglePlan={modes.onTogglePlan}
              onOpenGoal={onOpenGoal}
              planAvailable={modes.planAvailable}
            />
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Plugin contributions sit before the built-in controls, in store
            order. An empty slot renders nothing, so this row is unchanged. */}
        <PluginComposerActions text={text} isSubmitting={chatInFlight} />
        {/* Voice input — only when the browser can capture audio. Idle ▸ mic,
            recording ▸ pulsing red mic-off, transcribing ▸ spinner. */}
        {voiceSupported && (
          <button
            type="button"
            onClick={onVoiceToggle}
            disabled={voiceBusy}
            className={`flex items-center justify-center rounded transition-colors flex-shrink-0 ${
              voiceBusy
                ? 'text-ink/40 cursor-wait'
                : voiceListening
                  ? 'bg-error text-canvas animate-pulse shadow-xs cursor-pointer'
                  : 'text-ink/50 hover:text-ink hover:bg-ink/10 cursor-pointer'
            } ${
              isMobile ? 'w-8 h-8 rounded-md' : 'w-7 h-7'
            }`}
            title={
              voiceBusy
                ? 'Transcribing…'
                : voiceListening
                  ? 'Stop recording'
                  : 'Voice input (omp speech-to-text)'
            }
          >
            {voiceBusy ? (
              <Loader2 size={isMobile ? 14 : 12} className="animate-spin" />
            ) : voiceListening ? (
              <MicOff size={isMobile ? 14 : 12} />
            ) : (
              <Mic size={isMobile ? 14 : 12} />
            )}
          </button>
        )}

        {showStop && (
          <button
            type="button"
            onClick={onStop}
            className={`flex items-center justify-center rounded transition-colors cursor-pointer shadow-xs animate-in zoom-in-90 duration-150 flex-shrink-0 ${
              isMobile
                ? 'w-8 h-8 rounded-md border border-ink/25 text-ink hover:bg-error hover:text-canvas hover:border-error'
                : 'w-7 h-7 bg-ink text-canvas hover:bg-error hover:text-canvas'
            }`}
            title="Stop generation"
          >
            <Square size={isMobile ? 12 : 10} className="fill-current" />
          </button>
        )}

        <button
          type="button"
          onClick={onSend}
          disabled={sendDisabled}
          className={`flex items-center justify-center rounded bg-ink text-canvas hover:bg-ink/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex-shrink-0 ${
            isMobile ? 'w-8 h-8 rounded-md' : 'w-7 h-7'
          }`}
          title={chatInFlight ? 'Queue follow-up message' : 'Send message'}
          aria-label={chatInFlight ? 'Queue follow-up message' : 'Send message'}
        >
          <Send size={isMobile ? 14 : 12} className="ml-px" />
        </button>
      </div>
    </div>
  );
}
