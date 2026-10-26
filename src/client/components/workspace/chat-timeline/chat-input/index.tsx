import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ClipboardEvent, SetStateAction } from 'preact/compat';
import { AlertTriangle, X } from 'lucide-preact';
import type { Attachment } from '@/shared/types';
import { ComposerToolbar } from '@/client/components/workspace/chat-timeline/chat-input/Toolbar';
import { VoiceNotice } from '@/client/components/workspace/chat-timeline/chat-input/VoiceNotice';
import { ComposerTextarea } from '@/client/components/common/ComposerTextarea';
import { usePublishComposerState } from '@/client/hooks/chat/composer/publish-state';
import { useModelSelection } from '@/client/hooks/chat/composer/model-selection';
import { AttachmentToolbar } from '@/client/components/workspace/chat-timeline/chat-input/AttachmentToolbar';
import { NO_PENDING_PICK } from '@/client/hooks/chat/timeline/deferred-model';
import { useAutoGrow } from '@/client/hooks/chat/composer/auto-grow';
import { useVoiceInput } from '@/client/hooks/chat/composer/voice-input';
import { primeFileReads } from '@/client/hooks/chat/composer/file-reads';
import { useComposerPipeline } from '@/client/hooks/chat/composer/pipeline';
import { DropOverlay } from '@/client/components/workspace/chat-timeline/chat-input/DropOverlay';
import { GoalSurfaces } from '@/client/components/workspace/chat-timeline/chat-input/GoalSurfaces';
import { normalizeGoalBudget } from '@/shared/lib/omp/mode/budget';
import { readKabmoSetting } from '@/shared/lib/settings/client';
import { useKeyboardInset } from '@/client/hooks/ui/keyboard-inset';
import { composerExpansion } from '@/client/components/workspace/chat-timeline/chat-input/expansion';
import { useComposerCompact } from '@/client/hooks/chat/composer/compact';
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
  shrinkWhileReading = false,
}: ChatInputProps) {
  const [internalAttachments, setInternalAttachments] = useState<Attachment[]>([]);
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

  const attachments = externalAttachments !== undefined ? externalAttachments : internalAttachments;
  const setAttachments = (updater: SetStateAction<Attachment[]>) => {
    if (onAttachmentsChange) {
      // Forward the updater untouched: onAttachmentsChange is a state setter,
      // so functional updates stay functional. Evaluating them here against
      // the closure `attachments` would resurrect stale state (e.g. the async
      // FileReader callback wiping the just-added image).
      onAttachmentsChange(updater);
    } else {
      setInternalAttachments(updater);
    }
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
  // A modal composer sizes itself to its content; the chat's keeps its fixed
  // box (see `autoGrow`). The hook is unconditional — its ref is simply unused
  // when growth is off.
  const growRef = useAutoGrow({
    value,
    minHeightPx: autoGrow?.minHeightPx ?? 0,
    maxHeightPx: autoGrow?.maxHeightPx ?? Number.POSITIVE_INFINITY,
  });

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
    <div
      ref={cardRef}
      className={`@container transition-colors flex flex-col ${layout.cardPositionClass} ${layout.cardClass} ${layout.cardLayoutClass} ${className}`}
      style={layout.style}
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
      {...dropProps}
    >
      <DropOverlay visible={isDragging} />

      {/* Goal mode strip describes the turn the next message will join. */}
      <GoalSurfaces
        modes={modes}
        running={chatRunning ?? isGenerating}
        open={goalModalOpen}
        defaultBudget={normalizeGoalBudget(readKabmoSetting<number>('goalDefaultBudget', appSettings))}
        onOpen={() => setGoalModalOpen(true)}
        onClose={() => setGoalModalOpen(false)}
      />

      <AttachmentToolbar
        attachments={attachments}
        onFilesSelected={(files) => acceptFiles(files)}
        onRemove={removeAttachment}
        // The phone hosts the mode toggles here; the desktop keeps them in the
        // bottom toolbar, which has room. `showAccess` gates both hosts.
        modes={isMobile && showAccess ? modes : undefined}
        onOpenGoal={() => setGoalModalOpen(true)}
        // Only the chat's own composer stretches; a caller that owns its size
        // (the New Chat modal) gets no control and cannot be stretched.
        expanded={expandable ? expanded : undefined}
        onToggleExpand={expandable ? () => setExpanded((prev) => !prev) : undefined}
        compact={compact}
        onExpandComposer={reopen}
      />

      {/* Refused plan/goal command notice. */}
      {(notice || modes?.error) && (
        <div className="flex items-start gap-1.5 bg-error/5 px-3 py-1.5 text-[11px] text-error">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{notice || modes?.error}</span>
          <button
            type="button"
            onClick={() => (notice ? dismissNotice() : modes?.clearError())}
            className="shrink-0 text-error/60 hover:text-error transition-colors"
            title="Dismiss"
          >
            <X size={11} />
          </button>
        </div>
      )}

      {/* Textarea. Not rendered at all while compact: the phone gives the
          transcript its height back by removing the box, not by shrinking it,
          and `AttachmentToolbar` then carries the "Type here" target that
          brings it back. Rendering it at `h-0` would keep a focusable element
          with no pixels, which is exactly the trap the `inert` rules elsewhere
          exist to avoid. */}
      {!compact && (
        <ComposerTextarea
          value={value}
          onChange={onChange}
          onSend={submit}
          disabled={disabled}
          appSettings={appSettings}
          rootPath={rootPath}
          enablePicker={enablePicker}
          placement={layout.pickerPlacement}
          wrapperClassName={layout.wrapperClass}
          placeholder={placeholder ?? (disabled ? "Please select a workspace above to start prompting..." : "@ for files/agents; / for commands and skills (Paste images/files here)")}
          className={`w-full bg-transparent border-none focus:outline-none resize-none text-ink placeholder-ink/40 disabled:opacity-50 disabled:cursor-not-allowed ${layout.textareaClass}`}
          onPaste={handlePaste}
          variant={variant}
          textareaRef={autoGrow ? growRef : undefined}
          onReady={onTextareaReady}
        />
      )}
      {/* Dictation progress / failure, above the toolbar that owns the mic. */}
      <VoiceNotice status={voiceStatus} error={displayedVoiceError} />

      {/* Bottom Config Toolbar */}
      <ComposerToolbar
        isMobile={isMobile}
        selectedModel={selectedModel}
        onSelectModel={(model) => {
          setSelectedModel(model);
          onModelChange?.(model.provider, model.id);
        }}
        thinkingLevels={thinkingLevels}
        currentThinking={currentThinking}
        onSelectThinking={selectThinking}
        onThinkingLevelChange={onThinkingLevelChange}
        isGenerating={isGenerating}
        chatRunning={chatRunning}
        onStop={onStop}
        onSend={() => submit()}
        sendDisabled={disabled || (!value.trim() && attachments.length === 0)}
        accessMode={accessMode}
        onSelectAccess={onAccessModeChange}
        showModel={showModel}
        showThinking={showThinking}
        showAccess={showAccess}
        modes={modes}
        onOpenGoal={() => setGoalModalOpen(true)}
        voiceSupported={voiceSupported}
        voiceListening={voiceListening}
        voiceBusy={voiceBusy}
        onVoiceToggle={handleVoiceToggle}
        text={value}
      />
    </div>
  );
}
