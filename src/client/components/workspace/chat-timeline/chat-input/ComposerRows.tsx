/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's five rows, built once and handed to `ComposerFrame`.
 *
 * Every row is ALWAYS constructed here — the frame decides only their ORDER,
 * never whether they exist. That split is what makes "a style cannot drop a
 * control" a property of the code rather than of a reviewer's attention.
 *
 * Split out of `ChatInput` for the per-file ceiling: the composer owns state
 * (draft, attachments, expansion, compact, voice, pipeline) and this file owns
 * the markup those states produce.
 */

import type { ClipboardEvent, RefObject } from 'preact/compat';
import type { ComponentChildren } from 'preact';
import type { AIModelOption, Attachment } from '@/shared/types';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import type { ComposerRow } from '@/shared/lib/chat/composer/style';
import type { ComposerModes } from '@/client/components/workspace/chat-timeline/chat-input/modes-props';
import type { ComposerPickerPlacement } from '@/client/components/common/ComposerPicker';
import { AttachmentToolbar } from '@/client/components/workspace/chat-timeline/chat-input/AttachmentToolbar';
import { ComposerNotice } from '@/client/components/workspace/chat-timeline/chat-input/ComposerNotice';
import { ComposerTextarea } from '@/client/components/common/ComposerTextarea';
import { ComposerToolbar } from '@/client/components/workspace/chat-timeline/chat-input/Toolbar';
import { VoiceNotice } from '@/client/components/workspace/chat-timeline/chat-input/VoiceNotice';

export interface ComposerRowsInput {
  /** Textarea sizing from `composerExpansion` (the style's own pixels are CSS). */
  textareaClass: string;
  wrapperClass: string;
  pickerPlacement: ComposerPickerPlacement;

  attachments: Attachment[];
  onFilesSelected: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  modes?: ComposerModes;
  onOpenGoal: () => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
  compact: boolean;
  onExpandComposer: () => void;

  notice: string | null;
  dismissNotice: () => void;

  value: string;
  onChange: (value: string) => void;
  submit: (options?: { steering?: boolean }) => void;
  sendDisabled: boolean;
  disabled: boolean;
  appSettings?: Record<string, any>;
  rootPath?: string | null;
  enablePicker?: boolean;
  placeholder?: string;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  variant: 'desktop' | 'mobile';
  textareaRef: RefObject<HTMLTextAreaElement>;
  onTextareaReady: (element: HTMLTextAreaElement | null) => void;

  voiceStatus: Parameters<typeof VoiceNotice>[0]['status'];
  voiceError: string | null;

  isMobile: boolean;
  selectedModel: AIModelOption | null;
  onSelectModel: (model: AIModelOption) => void;
  thinkingLevels: string[];
  currentThinking: string;
  onSelectThinking: (level: string) => void;
  onThinkingLevelChange?: (level: string) => void;
  isGenerating: boolean;
  chatRunning?: boolean;
  onStop?: () => void;
  accessMode?: ApprovalMode;
  onSelectAccess?: (mode: ApprovalMode) => void;
  showModel?: boolean;
  showThinking?: boolean;
  showAccess?: boolean;
  voiceSupported?: boolean;
  voiceListening?: boolean;
  voiceBusy?: boolean;
  onVoiceToggle?: () => void;
}

export function composerRows({
  textareaClass,
  wrapperClass,
  pickerPlacement,
  ...input
}: ComposerRowsInput): Record<ComposerRow, ComponentChildren> {
  return {
    attachments: (
      <AttachmentToolbar
        attachments={input.attachments}
        onFilesSelected={input.onFilesSelected}
        onRemove={input.onRemoveAttachment}
        // The phone hosts the mode toggles here; the desktop keeps them in the
        // bottom toolbar, which has room. `showAccess` gates both hosts.
        modes={input.isMobile && input.showAccess ? input.modes : undefined}
        onOpenGoal={input.onOpenGoal}
        // Only the chat's own composer stretches; a caller that owns its size
        // (the New Chat modal) gets no control and cannot be stretched.
        expanded={input.onToggleExpand ? input.expanded : undefined}
        onToggleExpand={input.onToggleExpand}
        compact={input.compact}
        onExpandComposer={input.onExpandComposer}
      />
    ),

    notice: (
      <ComposerNotice
        notice={input.notice}
        modeError={input.modes?.error}
        onDismissNotice={input.dismissNotice}
        onDismissModeError={input.modes?.clearError}
      />
    ),

    // Not rendered at all while compact: the phone gives the transcript its
    // height back by removing the box, not by shrinking it, and the attachment
    // row then carries the "Type here" target that brings it back. A `h-0` box
    // would keep a focusable element with no pixels.
    draft: input.compact ? null : (
      <ComposerTextarea
        value={input.value}
        onChange={input.onChange}
        onSend={input.submit}
        disabled={input.disabled}
        appSettings={input.appSettings}
        rootPath={input.rootPath}
        enablePicker={input.enablePicker}
        placement={pickerPlacement}
        wrapperClassName={wrapperClass}
        placeholder={input.placeholder}
        className={`composer-draft w-full bg-transparent border-none focus:outline-none resize-none text-ink placeholder-ink/40 disabled:opacity-50 disabled:cursor-not-allowed ${textareaClass}`}
        onPaste={input.onPaste}
        variant={input.variant}
        textareaRef={input.textareaRef}
        onReady={input.onTextareaReady}
      />
    ),

    // Dictation progress / failure, beside the toolbar that owns the mic.
    voice: <VoiceNotice status={input.voiceStatus} error={input.voiceError} />,

    toolbar: (
      <ComposerToolbar
        isMobile={input.isMobile}
        selectedModel={input.selectedModel}
        onSelectModel={input.onSelectModel}
        thinkingLevels={input.thinkingLevels}
        currentThinking={input.currentThinking}
        onSelectThinking={input.onSelectThinking}
        onThinkingLevelChange={input.onThinkingLevelChange}
        isGenerating={input.isGenerating}
        chatRunning={input.chatRunning}
        onStop={input.onStop}
        onSend={() => input.submit()}
        sendDisabled={input.sendDisabled}
        accessMode={input.accessMode}
        onSelectAccess={input.onSelectAccess}
        showModel={input.showModel}
        showThinking={input.showThinking}
        showAccess={input.showAccess}
        modes={input.modes}
        onOpenGoal={input.onOpenGoal}
        voiceSupported={input.voiceSupported}
        voiceListening={input.voiceListening}
        voiceBusy={input.voiceBusy}
        onVoiceToggle={input.onVoiceToggle}
        text={input.value}
      />
    ),
  };
}
