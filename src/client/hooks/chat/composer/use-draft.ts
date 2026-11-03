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
 *
 * A LANDING draft (no `?sessionId=` in the URL) is memory-only.
 *
 * The landing mounts `SessionStateProvider` on its fallback id (`'1'`), which
 * is not a chat: the composer there is disabled until a workspace is picked, so
 * nothing the user does can send or clear it. Persisting under that id made the
 * slot permanent — measured: a browser-panel annotation appended once at the
 * landing was still sitting in the composer on every later launch, looking like
 * text a new chat had inherited. A draft belongs to the chat named in the URL;
 * with no chat named, it is kept for this page session only.
 */

import { useState } from 'preact/hooks';
import { useSearchParams } from '@/client/lib/router/search-params';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { useBrowserPageContextInsert } from '@/client/hooks/chat/composer/browser-context';
import { useReviewIncludeInsert } from '@/client/hooks/chat/composer/review-context';
import { CHAT_DRAFT_ATTACHMENTS_KEY, CHAT_DRAFT_KEY } from '@/shared/lib/chat/composer/draft';
import type { Attachment } from '@/shared/types';

export interface ComposerDraftState {
  inputValue: string;
  setInputValue: (value: string | ((prev: string) => string)) => void;
  inputAttachments: Attachment[];
  setInputAttachments: (value: Attachment[] | ((prev: Attachment[]) => Attachment[])) => void;
}

export function useComposerDraft(): ComposerDraftState {
  const [searchParams] = useSearchParams();
  const scoped = Boolean(searchParams.get('sessionId'));

  // Both branches are mounted unconditionally (hook order) and the scope only
  // picks which one this render OBSERVES: the session copy keeps following the
  // store, and the landing copy keeps whatever was typed at the landing, so
  // stepping into a chat and back does not destroy either.
  const [storedText, setStoredText] = useSessionState<string>(CHAT_DRAFT_KEY, '');
  const [storedAttachments, setStoredAttachments] = useSessionState<Attachment[]>(CHAT_DRAFT_ATTACHMENTS_KEY, []);
  const [landingText, setLandingText] = useState('');
  const [landingAttachments, setLandingAttachments] = useState<Attachment[]>([]);

  const inputValue = scoped ? storedText : landingText;
  const setInputValue = scoped ? setStoredText : setLandingText;
  useBrowserPageContextInsert(setInputValue);
  useReviewIncludeInsert(setInputValue);

  const inputAttachments = scoped ? storedAttachments : landingAttachments;
  const setInputAttachments = scoped ? setStoredAttachments : setLandingAttachments;
  return { inputValue, setInputValue, inputAttachments, setInputAttachments };
}
