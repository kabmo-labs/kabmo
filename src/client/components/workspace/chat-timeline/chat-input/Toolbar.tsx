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
  /** Which harness runs this chat, and whether the tab strip may change it. */
  harness?: string;
  harnessEditable?: boolean;
  onSelectHarness?: (harness: string) => void;
}

/**
 * The chat's two ACTION controls, one geometry.
 *
 * They used to state their own boxes: `rounded` on send (4px, below DESIGN.md
 * §5's 6-8px control radius) and `rounded-md` on a phone's stop, so the pair
 * disagreed on radius and only agreed on size by coincidence. Both are 28px on
 * a desktop and 32px on a phone, from ONE pair of classes below, so a future
 * size change cannot land on one control and miss the other.
 *
 * `focus-visible` is not decoration: the send and stop controls had no focus
 * treatment at all, so the two controls that start and end a turn were the only
 * interactive elements in the composer a keyboard user could not see. The ring
 * is ink at 50%, not the `/20`-`/30` the timeline cards use: WCAG 1.4.11 wants
 * 3:1 for a focus indicator, and on `paper` the ramp measures `/30` 1.97, `/45`
 * 2.96 and `/50` 3.43. It is offset by 2px of the card's own paper so it reads
 * as a halo on the filled send button too. The voice control shares this base
 * because it is the third member of the same cluster.
 *
 * The transition is Tailwind's own `transition` (colour, background, border,
 * box-shadow, transform), not a hand-listed property set: those are the five
 * things this button changes, and they are the default for a reason.
 */
const ACTION_BASE =
  'tap-target flex items-center justify-center rounded-lg flex-shrink-0 cursor-pointer ' +
  'transition duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/50 ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-paper active:scale-95';

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
  harness,
  harnessEditable = true,
  onSelectHarness,
}: ComposerToolbarProps) {
  const chatInFlight = chatRunning ?? isGenerating;
  const showStop = chatInFlight && (isMobile ? Boolean(onStop) : true);
  // The pair's box, and its glyph, from the one layout flag: 32px on a phone
  // (the touch floor's real geometry) and 28px on the desktop toolbar the
  // comment above measured.
  const actionSize = isMobile ? 'w-8 h-8' : 'w-7 h-7';
  const iconSize = isMobile ? 14 : 12;

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
            harness={harness}
            harnessEditable={harnessEditable}
            onSelectHarness={onSelectHarness}
            isMobile={isMobile}
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
              goalArm={modes.goalArm}
              goalRecord={modes.goalRecord}
              pending={modes.pending}
              onTogglePlan={modes.onTogglePlan}
              onOpenGoal={onOpenGoal}
              planAvailable={modes.planAvailable}
              goalAvailable={modes.goalAvailable}
            />
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Plugin contributions sit before the built-in controls, in store
            order. An empty slot renders nothing, so this row is unchanged. */}
        <PluginComposerActions text={text} isSubmitting={chatInFlight} />
        {/* Voice input — only when the browser can capture audio. Idle ▸ mic,
            recording ▸ pulsing red mic-off, transcribing ▸ spinner. It shares
            the action pair's geometry: it is the third control of one cluster,
            and a 4px radius beside two 8px ones was the same class of drift
            this file's `ACTION_BASE` exists to stop. */}
        {voiceSupported && (
          <button
            type="button"
            onClick={onVoiceToggle}
            disabled={voiceBusy}
            className={`${ACTION_BASE} ${actionSize} ${
              voiceBusy
                ? 'text-ink/40 cursor-wait'
                : voiceListening
                  ? 'bg-error-text text-canvas animate-pulse shadow-xs'
                  : 'text-ink/50 hover:text-ink hover:bg-ink/10'
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
              <Loader2 size={iconSize} className="animate-spin" />
            ) : voiceListening ? (
              <MicOff size={iconSize} />
            ) : (
              <Mic size={iconSize} />
            )}
          </button>
        )}

        {/* Stop is the RED half of the pair: a filled signal control, which is
            how the rest of the app draws "end this" (the delete dialogs, the
            batch bar). It used to be an outline with a red tint on hover, and
            the pair then read as one primary and one ghost when the two do
            different things.

            The fill is `bg-error-text`, NOT `bg-error`: the `-text` token is
            the palette's own red solved until it clears 4.5:1 against paper
            and canvas, so the button is a visible shape on all 63 palettes
            (measured: `bg-error` reaches 2.73:1 against `mono-light`'s paper),
            and a `text-canvas` glyph on it reads 4.50:1 minimum. The raw
            palette hex is chosen for a chip's ground, not for a button the
            user has to find.

            `shadow-xs` is the same lift the send control carries, so the pair is
            one object; the entrance animation this used to carry was
            `animate-in zoom-in-90`, which no build has ever emitted (no animate
            plugin in the bundle): it was a dead class, and the composer's
            motion is reserved for live state anyway. */}
        {showStop && (
          <button
            type="button"
            onClick={onStop}
            className={`${ACTION_BASE} ${actionSize} bg-error-text text-canvas shadow-xs hover:bg-error-text-hover`}
            title="Stop generation"
            aria-label="Stop generation"
          >
            <Square size={iconSize} className="fill-current" />
          </button>
        )}

        {/* Send is the BLUE half of the pair, and the one that must stay
            findable at rest: a run is started from here and stopped from the
            red control beside it, so the two states are told apart by hue
            before the glyph is read.

            `bg-info-text` for the same reason Stop uses `bg-error-text`: it is
            the palette's blue solved to 4.5:1 against paper and canvas, so the
            control is a shape on every palette (`bg-info` reaches 1.94:1 on
            `aura-light`) and its `text-canvas` glyph clears 4.50:1. A
            one-pixel lift on hover and a press-scale are the whole state
            language; the disabled state is the house pair (40% opacity, no
            shadow) rather than a washed-out fill, because a lighter FILL moves
            the glyph off the inverted-surface rule and into the icon mode's own
            hue. */}
        <button
          type="button"
          onClick={onSend}
          disabled={sendDisabled}
          className={`${ACTION_BASE} ${actionSize} bg-info-text text-canvas shadow-xs hover:bg-info-text-hover hover:shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:hover:bg-info-text`}
          title={chatInFlight ? 'Queue follow-up message' : 'Send message'}
          aria-label={chatInFlight ? 'Queue follow-up message' : 'Send message'}
        >
          <Send size={iconSize} className="ml-px" />
        </button>
      </div>
    </div>
  );
}
