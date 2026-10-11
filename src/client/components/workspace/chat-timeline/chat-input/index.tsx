import { useState } from 'preact/hooks';
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
import { readChamberSetting } from '@/shared/lib/settings/client';
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
}: ChatInputProps) {
  const [internalAttachments, setInternalAttachments] = useState<Attachment[]>([]);
  // The Goal modal is owned here, not by the toolbar: the button is a toggle,
  // and the modal it opens needs the same `modes` slice the toolbar got.
  const [goalModalOpen, setGoalModalOpen] = useState(false);

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
      className={`@container relative border rounded-md bg-paper transition-colors flex flex-col shadow-sm ${
        isDragging ? 'border-ink/40' : 'border-ink/20 focus-within:border-ink'
      } ${className}`}
      {...dropProps}
    >
      <DropOverlay visible={isDragging} />

      {/* Goal mode strip describes the turn the next message will join. */}
      <GoalSurfaces
        modes={modes}
        running={chatRunning ?? isGenerating}
        open={goalModalOpen}
        defaultBudget={normalizeGoalBudget(readChamberSetting<number>('goalDefaultBudget', appSettings))}
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
      />

      {/* Refused plan/goal command notice. */}
      {(notice || modes?.error) && (
        <div className="flex items-start gap-1.5 border-b border-error/20 bg-error/5 px-3 py-1.5 text-[11px] text-error">
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

      {/* Textarea */}
      <ComposerTextarea
        value={value}
        onChange={onChange}
        onSend={submit}
        disabled={disabled}
        appSettings={appSettings}
        rootPath={rootPath}
        enablePicker={enablePicker}
        placeholder={placeholder ?? (disabled ? "Please select a workspace above to start prompting..." : "@ for files/agents; / for commands and skills (Paste images/files here)")}
        className={`w-full bg-transparent border-none focus:outline-none resize-none text-ink placeholder-ink/40 disabled:opacity-50 disabled:cursor-not-allowed ${
          isMobile ? 'px-3 py-3 text-base min-h-[68px] max-h-40' : 'px-3 py-3 text-sm min-h-[80px]'
        }`}
        onPaste={handlePaste}
        variant={variant}
        textareaRef={autoGrow ? growRef : undefined}
        onReady={onTextareaReady}
      />

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
