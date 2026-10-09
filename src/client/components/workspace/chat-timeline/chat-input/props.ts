/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The composer's props, split from its implementation so the component file
 * stays under the repo's per-file ceiling. Every field here is documented where
 * it changes behaviour; the component reads them all.
 */

import type { SetStateAction } from 'preact/compat';
import type { Attachment } from '@/shared/types';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import type { ComposerModes } from '@/client/components/workspace/chat-timeline/chat-input/modes-props';

export interface ChatInputProps {
  value: string;
  /**
   * The session this composer writes to, or null on a composer with no session
   * yet (the New Chat modal). Published to the plugin kit as the composer's
   * `scope`, so a plugin knows which conversation its draft belongs to.
   */
  sessionId?: string | null;
  onChange: (v: string) => void;
  onSend: (attachments: Attachment[], options?: { steering?: boolean }) => void;
  isGenerating: boolean;
  onStop?: () => void;
  className?: string;
  disabled?: boolean;
  appSettings?: Record<string, any>;
  attachments?: Attachment[];
  onAttachmentsChange?: (attachments: SetStateAction<Attachment[]>) => void;
  onThinkingLevelChange?: (level: string) => void;
  onModelChange?: (provider: string, modelId: string) => void;
  /** Model last used by the active session (omp `model_change` entry). */
  sessionModel?: { provider: string; modelId: string } | null;
  /** Thinking level last used by the active session (omp `thinking_level_change` entry). */
  sessionThinkingLevel?: string | null;
  rootPath?: string | null;
  /** The chat session's access mode; omit it on a composer whose access
   *  selector is off (the side-question form). */
  accessMode?: ApprovalMode;
  onAccessModeChange?: (mode: ApprovalMode) => void;
  /**
   * Which of the toolbar's selectors render. The side-question composer turns
   * all three off: its child runs on the chat's model and thinking selector and
   * without tools, so a control there would change nothing.
   */
  showModel?: boolean;
  showThinking?: boolean;
  showAccess?: boolean;
  /**
   * Which plan/goal modes the CHAT is in, plus the handlers that change them.
   * Omitted by every composer that does not own a chat turn — the side-question
   * form runs on the parent's modes and must not offer its own, and the New Chat
   * modal has no session to change them on yet.
   */
  modes?: ComposerModes;
  /**
   * Whether the `@` / `/` / `!` / `#` autocomplete runs. Off for the
   * side-question form, which has no file tree, commands or skills to offer —
   * and whose text is never run through the mention translator.
   */
  enablePicker?: boolean;
  /** Overrides the default hint text (the side-question form names its own). */
  placeholder?: string;
  /**
   * `mobile` sizes the composer for a phone: 16px text (iOS Safari zooms the
   * viewport when focusing an input below that), thumb-sized send/stop
   * targets, and Enter-to-newline instead of Enter-to-send.
   */
  variant?: 'desktop' | 'mobile';
  /**
   * Grow the textarea with its content, up to a ceiling, instead of keeping a
   * fixed box that scrolls. On for a modal composer (the card is the only thing
   * on screen, so growing it costs nothing); off for the chat, where a growing
   * composer would push the conversation around under the reader.
   */
  autoGrow?: { minHeightPx: number; maxHeightPx: number };
  composerModelRef: { current: { provider: string; modelId: string; thinkingLevel: string } | null };
  deferredComposerPickRef?: { current: { provider?: string; modelId?: string; thinkingLevel?: string } | null };
  /**
   * The CHAT-level "a run is in flight" flag (`timelineRunning`), for rows that
   * describe the run rather than this draft — the goal strip and the Stop
   * button. Falls back to `isGenerating`, which is this client's own run: a
   * composer that only knows what it started would show an idle goal and no
   * way to stop a turn, while another tab's run streams — the same
   * disagreement `timelineRunning` exists to prevent.
   */
  chatRunning?: boolean;
}
