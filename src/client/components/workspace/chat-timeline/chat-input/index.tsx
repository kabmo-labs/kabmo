import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ClipboardEvent, SetStateAction } from 'preact/compat';
import type { Attachment } from '@/shared/types';
import { useModelSelection } from '@/client/hooks/chat/composer/model-selection';
import { NO_PENDING_PICK } from '@/client/hooks/chat/timeline/deferred-model';
import { CHAT_COMPOSER_MAX_LINES, useAutoGrow } from '@/client/hooks/chat/composer/auto-grow';
import { useVoiceInput } from '@/client/hooks/chat/composer/voice-input';
import { primeFileReads } from '@/client/hooks/chat/composer/file-reads';
import { useComposerPipeline } from '@/client/hooks/chat/composer/pipeline';
import { usePublishComposerState } from '@/client/hooks/chat/composer/publish-state';
import { DropOverlay } from '@/client/components/workspace/chat-timeline/chat-input/DropOverlay';
import { GoalSurfaces } from '@/client/components/workspace/chat-timeline/chat-input/GoalSurfaces';
import { ComposerFrame } from '@/client/components/workspace/chat-timeline/chat-input/styles/index';
import { composerRows } from '@/client/components/workspace/chat-timeline/chat-input/ComposerRows';
import { normalizeGoalBudget } from '@/shared/lib/omp/mode/budget';
import { readKabmoSetting } from '@/shared/lib/settings/client';
import { useKeyboardInset } from '@/client/hooks/ui/keyboard-inset';
import { composerExpansion } from '@/client/components/workspace/chat-timeline/chat-input/expansion';
import { useComposerCompact } from '@/client/hooks/chat/composer/compact';
import { useComposerStyle } from '@/client/hooks/chat/composer/style';
import { composerStyleLayout } from '@/shared/lib/chat/composer/style';
import type { ChatInputProps } from '@/client/components/workspace/chat-timeline/chat-input/props';

export function ChatInput({ 
  value, 
  onChange, 
  sessionId, 
  onSend, 
  isGenerating,
  onStop,
  className = '',
  disabled = false,
  appSettings = {},
  attachments: externalAttachments,
  onAttachmentsChange,
  onThinkingLevelChange,
  onModelChange,
  sessionModel,
  sessionThinkingLevel,
  rootPath,
  variant = 'desktop',
  accessMode,
  onAccessModeChange,
  modes,
  showModel = true,
  showThinking = true,
  showAccess = true,
  enablePicker = true,
  placeholder,
  autoGrow,
  /** Mirrors the pick so the send path queues it without reading state. */
  composerModelRef,
  /** Pending pick from a previous turn; omits for non-streaming composers. */
  deferredComposerPickRef = NO_PENDING_PICK,
  chatRunning,
  expandable = false,
  hero = false,
  shrinkWhileReading = false,
}: ChatInputProps) {
  // The Goal modal is owned here, not by the toolbar: the button is a toggle,
  // and the modal it opens needs the same `modes` slice the toolbar got.
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  // Stretched: on a phone the composer takes the viewport, on a desktop its
  // textarea grows to a share of it. Local, like the Goal modal's flag — a
  // layout preference for one draft, not a setting, and the URL is what carries
  // the session it belongs to.
  const [expanded, setExpanded] = useState(false);
  // Whether anything inside the card has focus. A compacted composer restores
  // itself the moment the user reaches for it: shrinking the box under a finger
  // that is already typing is the one way this can be wrong.
  const [composerFocused, setComposerFocused] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const { selectedModel, setSelectedModel, thinkingLevels, currentThinking, selectThinking } = useModelSelection({
    composerModelRef,
    sessionModel,
    sessionThinkingLevel,
    deferredComposerPickRef,
    onThinkingLevelChange,
  });

  // Attachments: owned here when nobody else needs to read them (the New Chat
  // modal), forwarded through the caller's setter when a dock does. The
  // forward has to stay a state setter: evaluating a functional update here
  // against the closed-over value would resurrect stale state (the async
  // FileReader callback wiping the just-added image).
  const [internalAttachments, setInternalAttachments] = useState<Attachment[]>([]);
  const attachments = externalAttachments !== undefined ? externalAttachments : internalAttachments;
  const setAttachments = (updater: SetStateAction<Attachment[]>) => {
    if (onAttachmentsChange) onAttachmentsChange(updater);
    else setInternalAttachments(updater);
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboard = e.clipboardData;
    if (!clipboard) return;
    if (clipboard.files.length > 0) {
      e.preventDefault();
      const files = Array.from(clipboard.files);
      // Same rule as a drop: the clipboard's file permission is released when
      // this handler returns, so the reads are started here, in its tick.
      acceptFiles(files, false, [], primeFileReads(files));
    }
  };

  // A DISPATCHED send returns the composer to its docked size, on BOTH layouts.
  // Hooked into the pipeline rather than the click handler so every way in —
  // the Send button, Enter, Cmd+Enter steering, a queued follow-up — collapses
  // it, while a click that dispatched nothing (an empty draft, an unreadable
  // attachment) leaves the stretched box exactly where the user put it. Staying
  // stretched hides the answer being streamed on a phone, and on a desktop it
  // keeps a 38vh box over the conversation the prompt was written against.
  // Stable identity: the pipeline's `submit` closes over it, and a fresh arrow
  // per render would rebuild `submit` on every keystroke.
  const collapseOnSend = useCallback(() => setExpanded(false), []);

  // Attach-and-send pipeline: drop handling, the inline notice, and the send
  // guard all live in the hook, because a drop registers files before this
  // component re-renders and the send decision cannot read a stale prop.
  const { notice, dismissNotice, isDragging, dropProps, acceptFiles, removeAttachment, submit } = useComposerPipeline({
    attachments,
    setAttachments,
    value,
    disabled,
    rootPath,
    onSend,
    onSent: collapseOnSend,
  });

  // Publishes this composer's state to the plugin kit, and gives the kit a way
  // to write into it (through `onChange`, never the DOM).
  const { onTextareaReady } = usePublishComposerState({
    value,
    onChange,
    isSubmitting: isGenerating,
    sessionId: sessionId ?? null,
  });

  const isMobile = variant === 'mobile';

  // The soft keyboard's overlap with the viewport. Measured ONLY while
  // stretched: that is the one state where the card is bottom-anchored to the
  // screen and would otherwise sit behind the keys (a phone has no hardware
  // Enter, so the covered toolbar would be the only way to send). Docked, the
  // card is inside the chat's own column and the measurement is unused.
  const keyboardInset = useKeyboardInset(cardRef, expandable && expanded);
  const { compact, reopen, onCardPointerDown } = useComposerCompact({
    cardRef,
    isMobile,
    shrinkWhileReading,
    composerFocused,
    setComposerFocused,
    value,
    attachments,
  });
  const layout = composerExpansion({ variant, expanded, isDragging, keyboardInset });

  // The style only reorders rows and re-frames the card; every control below is
  // rendered in every style. `hero` is the empty-chat state `stage` reacts to —
  // the composer cannot see the transcript, so the caller says so, and the
  // default (false) keeps the docked shape for a caller that does not care.
  const style = useComposerStyle();
  const styleLayout = composerStyleLayout({ style, hero });
  // Position FIRST: `cardPositionClass` must not be cancelled by a later
  // position utility (Tailwind resolves those by emission order regardless of
  // class order, which is why `expansion.ts` keeps position in its own field).
  // The style contributes NO class here — its pixels are `[data-composer-style]`
  // rules in `tailwind.css`, because `rounded-md` beside `rounded-xl` lost.
  const cardClass = `${layout.cardPositionClass} ${layout.cardClass} ${layout.cardLayoutClass}`;
  const textareaClass = layout.textareaClass;

  // Growth: a modal composer states its own px bounds, the chat's docked one
  // grows to `CHAT_COMPOSER_MAX_LINES` lines. Either way it is measured only
  // while the layout does NOT own the height — a stretched composer is `h-full`
  // on a phone and a share of the viewport on a desktop, and a compact one
  // renders no textarea at all.
  const growRef = useAutoGrow({
    value,
    minHeightPx: autoGrow?.minHeightPx ?? 0,
    maxHeightPx: autoGrow?.maxHeightPx,
    maxLines: autoGrow ? undefined : CHAT_COMPOSER_MAX_LINES,
    enabled: !expanded && !compact,
  });

  // Escape returns to the docked composer. Bound to the document rather than to
  // the textarea so it works while the picker has focus — the picker consumes
  // Escape only while it is OPEN, and a stretched composer with a closed popup
  // would otherwise have no keyboard way out.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded]);

  // Browser dictation, delegated to omp's own local STT worker. The hook owns
  // capture + the socket; this component owns where the text lands and the
  // status line while a first-run model download is still going.
  const {
    voiceSupported,
    voiceListening,
    voiceBusy,
    voiceStatus,
    handleVoiceToggle,
    displayedVoiceError,
  } = useVoiceInput((transcript) => {
    // Append rather than replace: a dictation into a composer that already
    // holds a draft must not discard what the user typed.
    const existing = value.trim();
    onChange(existing ? `${existing} ${transcript}` : transcript);
  });

  return (
    <ComposerFrame
      layout={styleLayout}
      cardClass={cardClass}
      style={layout.style}
      className={className}
      cardRef={cardRef}
      expanded={expanded}
      // focusin/focusout BUBBLE, unlike focus/blur: the card has to learn that
      // the textarea inside it was focused, and a capture-phase `onFocus` on
      // this element is not the same question (it fires for the card's own
      // focus, which never happens). Preact maps `onFocusIn`/`onFocusOut` to
      // the native bubble-phase events.
      onFocusIn={() => setComposerFocused(true)}
      // A focusout is NOT proof the reader left the card. Re-opening from the
      // compact state REMOVES the "Type here" button that had focus, and the
      // browser emits a focusout for it after the new textarea has already been
      // focused — so the flag went false one tick later and the composer
      // collapsed again (measured: `focusin:BUTTON, focusout:BUTTON,
      // added:DIV, removed:DIV, added:BUTTON` — open and shut within a frame).
      // The question is where focus ENDED UP, which is only answerable after
      // the focus change has settled.
      onFocusOut={() => {
        requestAnimationFrame(() => {
          if (!cardRef.current?.contains(document.activeElement)) setComposerFocused(false);
        });
      }}
      // Press-time, not click-time — see `useComposerCompact` for why a click
      // never arrives in the compact state.
      onPointerDown={onCardPointerDown}
      dropProps={dropProps}
      header={
        <>
          <DropOverlay visible={isDragging} />

          {/* Goal mode strip describes the turn the next message will join. It
              is card chrome, not a row: it stays above the rows in every style. */}
          <GoalSurfaces
            modes={modes}
            running={chatRunning ?? isGenerating}
            open={goalModalOpen}
            defaultBudget={normalizeGoalBudget(readKabmoSetting<number>('goalDefaultBudget', appSettings))}
            onOpen={() => setGoalModalOpen(true)}
            onClose={() => setGoalModalOpen(false)}
          />
        </>
      }
      rows={composerRows({
        textareaClass,
        wrapperClass: layout.wrapperClass,
        pickerPlacement: layout.pickerPlacement,
        attachments,
        onFilesSelected: (files) => acceptFiles(files),
        onRemoveAttachment: removeAttachment,
        modes,
        onOpenGoal: () => setGoalModalOpen(true),
        expanded,
        onToggleExpand: expandable ? () => setExpanded((prev) => !prev) : undefined,
        compact,
        onExpandComposer: reopen,
        notice,
        dismissNotice,
        value,
        onChange,
        submit,
        sendDisabled: disabled || (!value.trim() && attachments.length === 0),
        disabled,
        appSettings,
        rootPath,
        enablePicker,
        placeholder: placeholder ?? (disabled ? "Please select a workspace above to start prompting..." : "@ for files/agents; / for commands and skills (Paste images/files here)"),
        onPaste: handlePaste,
        variant,
        textareaRef: growRef,
        onTextareaReady,
        voiceStatus,
        voiceError: displayedVoiceError,
        isMobile,
        selectedModel,
        onSelectModel: (model) => {
          setSelectedModel(model);
          onModelChange?.(model.provider, model.id);
        },
        thinkingLevels,
        currentThinking,
        onSelectThinking: selectThinking,
        onThinkingLevelChange,
        isGenerating,
        chatRunning,
        onStop,
        accessMode,
        onSelectAccess: onAccessModeChange,
        showModel,
        showThinking,
        showAccess,
        voiceSupported,
        voiceListening,
        voiceBusy,
        onVoiceToggle: handleVoiceToggle,
      })}
    />
  );
}
