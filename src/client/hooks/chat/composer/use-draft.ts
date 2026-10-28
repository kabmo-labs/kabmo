/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's persisted draft: its text and its pending attachments.
 *
 * One hook because the two slots are one draft — the sidebar asks whether a
 * chat still holds EITHER before it keeps that chat's row (`hasComposerDraft`),
 * and the browser-panel insert appends to the text beside the attachments that
 * arrived with it. Extracted from the timeline hook, which is at the repo's
 * per-file ceiling.
 */

import { useSessionState } from '@/client/hooks/workspace/session-state';
import { useBrowserPageContextInsert } from '@/client/hooks/chat/composer/browser-context';
import { CHAT_DRAFT_ATTACHMENTS_KEY, CHAT_DRAFT_KEY } from '@/shared/lib/chat/composer/draft';
import type { Attachment } from '@/shared/types';

export interface ComposerDraftState {
  inputValue: string;
  setInputValue: (value: string | ((prev: string) => string)) => void;
  inputAttachments: Attachment[];
  setInputAttachments: (value: Attachment[] | ((prev: Attachment[]) => Attachment[])) => void;
}

export function useComposerDraft(): ComposerDraftState {
  const [inputValue, setInputValue] = useSessionState<string>(CHAT_DRAFT_KEY, '');
  useBrowserPageContextInsert(setInputValue);
  const [inputAttachments, setInputAttachments] = useSessionState<Attachment[]>(CHAT_DRAFT_ATTACHMENTS_KEY, []);
  return { inputValue, setInputValue, inputAttachments, setInputAttachments };
}
