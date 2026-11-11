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

import { useEffect, useRef, useState } from 'preact/hooks';
import { useSearchParams } from '@/client/lib/router/search-params';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { useSessionStateContext } from '@/client/hooks/workspace/session-state/context';
import { subscribeSessionKey } from '@/shared/lib/workspace/session-state/listeners';
import { getSessionValue } from '@/shared/lib/workspace/session-state/store';
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
  const { sessionId } = useSessionStateContext();

  // The draft is normally private to this composer, but a CANCELLED held prompt
  // is written back into this very slot by another module (the sidebar's cancel,
  // the waiting dispatcher's failure path). Without this follow, the text lands
  // in the store and the mounted box — the one the user is looking at — keeps
  // rendering its empty copy.
  //
  // `applied` is not bookkeeping: `setStoredText` writes the store, which
  // notifies this very listener. Comparing against the last value applied (and
  // recording it BEFORE the setters run) is what makes the write converge
  // instead of recursing.
  const appliedRef = useRef({ text: storedText, attachments: storedAttachments });
  appliedRef.current = { text: storedText, attachments: storedAttachments };
  // Set while this listener is writing the value it just read: the setters
  // persist, which notifies this same listener. Re-entering there is how the
  // first version recursed until the stack ran out.
  const applyingRef = useRef(false);
  useEffect(() => {
    if (!scoped) return;
    const follow = () => {
      if (applyingRef.current) return;
      const text = getSessionValue<string>(sessionId, CHAT_DRAFT_KEY) ?? '';
      const attachments = getSessionValue<Attachment[]>(sessionId, CHAT_DRAFT_ATTACHMENTS_KEY) ?? [];
      if (text === appliedRef.current.text && attachments === appliedRef.current.attachments) return;
      appliedRef.current = { text, attachments };
      applyingRef.current = true;
      setStoredText(text);
      setStoredAttachments(attachments);
      applyingRef.current = false;
    };
    const offText = subscribeSessionKey(sessionId, CHAT_DRAFT_KEY, follow);
    const offAttachments = subscribeSessionKey(sessionId, CHAT_DRAFT_ATTACHMENTS_KEY, follow);
    return () => {
      offText();
      offAttachments();
    };
    // The two setters are state setters from `useSessionState`; re-subscribing
    // on their identity would tear down the listeners on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, scoped]);

  const inputValue = scoped ? storedText : landingText;
  const setInputValue = scoped ? setStoredText : setLandingText;
  useBrowserPageContextInsert(setInputValue);
  useReviewIncludeInsert(setInputValue);

  const inputAttachments = scoped ? storedAttachments : landingAttachments;
  const setInputAttachments = scoped ? setStoredAttachments : setLandingAttachments;
  return { inputValue, setInputValue, inputAttachments, setInputAttachments };
}
