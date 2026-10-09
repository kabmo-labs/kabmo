import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ClipboardEvent, SetStateAction } from 'preact/compat';
import { AlertTriangle, X } from 'lucide-preact';
import type { AIModelOption, Attachment, ModelEntry } from '@/shared/types';
import { ComposerToolbar } from '@/client/components/workspace/chat-timeline/chat-input/Toolbar';
import { VoiceNotice } from '@/client/components/workspace/chat-timeline/chat-input/VoiceNotice';
import { ComposerTextarea } from '@/client/components/common/ComposerTextarea';
import { AttachmentToolbar } from '@/client/components/workspace/chat-timeline/chat-input/AttachmentToolbar';
import { selectableThinkingLevels } from '@/shared/lib/models/thinking-levels';
import { fetchModelsData, subscribeModelsUpdated } from '@/shared/lib/models/client';
import { resolveThinkingLevel, selectionFor } from '@/client/components/workspace/chat-timeline/chat-input/selection';
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

  // Selected Model State — starts null and is filled from `/api/models` (session
  // pick → persisted pick → registry default). Seeding a demo catalog entry here
  // showed a fabricated provider in the composer before the real list arrived.
  const [selectedModel, setSelectedModel] = useState<AIModelOption | null>(null);
  const [currentThinking, setCurrentThinking] = useState('auto');
  // Live mirror for the send path's queue snapshot (see composerModelRef).
  useEffect(() => {
    if (!selectedModel?.id) return;
    composerModelRef.current = {
      provider: selectedModel.provider,
      modelId: selectedModel.id,
      thinkingLevel: selectedModel.thinkingLevel ?? 'auto',
    };
  }, [selectedModel?.provider, selectedModel?.id, selectedModel?.thinkingLevel, composerModelRef]);
  // Mirror session model/thinking so async sync effects do not clobber them.
  const sessionThinkingLevelRef = useRef<string | null>(null);
  sessionThinkingLevelRef.current = sessionThinkingLevel ?? null;
  const sessionModelRef = useRef<{ provider: string; modelId: string } | null>(sessionModel ?? null);
  sessionModelRef.current = sessionModel ?? null;

  // Adopt the active session's model. A pending pick wins over adoption.
  useEffect(() => {
    if (!sessionModel?.provider || !sessionModel.modelId) return;
    if (deferredComposerPickRef.current) return;
    let active = true;
    fetchModelsData()
      .then((data) => {
        if (!active || !sessionModel) return;
        if (deferredComposerPickRef.current) return;
        const match = (data.modelList || []).find(
          (m) => m.id === sessionModel.modelId && m.provider === sessionModel.provider
        );
        if (match) {
          setSelectedModel(prev => selectionFor(match, sessionThinkingLevelRef.current, prev));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [sessionModel?.provider, sessionModel?.modelId, deferredComposerPickRef]);

  // Adopt the session's thinking level; a pending pick wins.
  useEffect(() => {
    if (!sessionThinkingLevel) return;
    if (deferredComposerPickRef.current?.thinkingLevel) return;
    setSelectedModel(prev => {
      if (!prev) return prev;
      const level = resolveThinkingLevel(prev.thinkingLevels, sessionThinkingLevel, prev.thinkingLevel);
      return level === prev.thinkingLevel ? prev : { ...prev, thinkingLevel: level };
    });
  }, [sessionThinkingLevel, deferredComposerPickRef]);

  // Sync selected model from server and event listener
  useEffect(() => {
    let active = true;
    const syncModel = async () => {
      try {
        const data = await fetchModelsData();
        if (!active) return;
        // A pick waiting for the next prompt owns the composer's selection:
        // every branch below would replace it with a session/catalog default.
        if (deferredComposerPickRef.current) return;
        if (Array.isArray(data.modelList) && data.modelList.length > 0) {
          // 1. The active session's last-used model is authoritative; even when
          // it is missing from the catalog, never replace it with the default.
          const sm = sessionModelRef.current;
          if (sm?.provider && sm.modelId) {
            const match = data.modelList.find((m: ModelEntry) => m.id === sm.modelId && m.provider === sm.provider);
            if (match) {
              setSelectedModel(prev => selectionFor(match, sessionThinkingLevelRef.current, prev));
            }
            return;
          }
          // 2. The user's persisted pick (survives new sessions).
          const persisted = data.selectedModel;
          if (persisted?.provider && persisted.id) {
            const match = data.modelList.find((m: ModelEntry) => m.id === persisted.id && m.provider === persisted.provider);
            if (match) {
              setSelectedModel(prev => selectionFor(match, sessionThinkingLevelRef.current, prev));
              return;
            }
          }
          // 3. Registry default.
          const defaultModel = data.defaultModel;
          if (defaultModel) {
            const match = data.modelList.find((m: ModelEntry) => m.id === defaultModel.modelId && m.provider === defaultModel.provider);
            if (match) {
              setSelectedModel(prev => selectionFor(match, sessionThinkingLevelRef.current, prev));
            }
          }
        } else if (data.selectedModel) {
          const selected = data.selectedModel;
          setSelectedModel(prev => ({
            ...selected,
            thinkingLevel: resolveThinkingLevel(selected.thinkingLevels, sessionThinkingLevelRef.current, prev?.thinkingLevel ?? selected.thinkingLevel),
          }));
        }
      } catch {}
    };

    syncModel();
    const unsubscribe = subscribeModelsUpdated(syncModel);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [deferredComposerPickRef]);

  // Thinking Dropdown State - Reactive with selectedModel
  const thinkingLevels = useMemo(() => {
    return selectableThinkingLevels(selectedModel?.thinkingLevels);
  }, [selectedModel]);

  const handleSelectThinking = (level: string) => {
    setCurrentThinking(level);
    setSelectedModel(prev => (prev ? { ...prev, thinkingLevel: level } : prev));
    onThinkingLevelChange?.(level);
  };

  // Re-sync the thinking dropdown label when the model dropdown's thinking
  // pill cycles the level (it updates `selectedModel.thinkingLevel`).
  useEffect(() => {
    if (selectedModel?.thinkingLevel) {
      setCurrentThinking(selectedModel.thinkingLevel);
    }
  }, [selectedModel?.thinkingLevel]);

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
        onSelectThinking={handleSelectThinking}
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
