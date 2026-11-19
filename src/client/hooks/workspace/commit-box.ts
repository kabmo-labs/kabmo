/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The commit box's state: the draft message, the amend checkbox, and the
 * pre-fill that makes Amend usable without retyping the message it rewrites.
 *
 * **Ticking Amend seeds the draft with HEAD's message, and the seeding is
 * one-shot and never destructive.** `git commit --amend` REPLACES the message,
 * so an empty box means the user is asked to retype what is already in the
 * repository — and the common amend is a tweak to the previous subject (a typo,
 * a missing scope, a forgotten ticket id). Three rules keep the pre-fill from
 * becoming its own bug:
 *
 *  - **A draft the user already typed is never overwritten.** The read is a
 *    round trip, so the check is against the LIVE draft when it lands, not
 *    against the one seen when the box was ticked — otherwise typing during the
 *    fetch would have the answer land on top of it.
 *  - **Un-ticking clears the seeded text, and only that.** `seededRef` records
 *    what this hook wrote; a draft the user edited is theirs to keep, so
 *    un-ticking after an edit leaves the box alone. That is also what makes
 *    "ganti total" work: the seeded message is ordinary editable text, not a
 *    placeholder.
 *  - **The read is on demand** (`?headMessage=1`), because the status payload
 *    travels on the realtime `git:` topic and is republished on every tool
 *    call — one `git log` per tool call for a checkbox nobody ticked.
 *
 * A repository whose HEAD is unborn answers `null`; nothing is seeded, and the
 * box keeps the placeholder it always had.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useSessionState, useSessionStateSnapshot } from '@/client/hooks/workspace/session-state';
import { pushToast } from '@/client/hooks/ui/toasts';

interface UseCommitBoxOptions {
  rootPath?: string;
  /** The working tree the commit runs in — the pre-fill reads the same scope. */
  repo: string;
  execute: (actionType: string, file?: string, extra?: Record<string, string>) => void;
}

export interface CommitBoxState {
  message: string;
  setMessage: (value: string) => void;
  amend: boolean;
  /** True while the draft is still exactly the text this hook seeded. */
  seeded: boolean;
  /** The checkbox handler: it is what triggers the pre-fill. */
  toggleAmend: (next: boolean) => void;
  commit: () => void;
  /** True while the commit-message model is answering. */
  isGenerating: boolean;
  /** A generated message that was NOT written into a non-empty draft. */
  suggestion: string | null;
  /** True while the draft is the generated text and the user has not edited it. */
  generated: boolean;
  generate: () => void;
  useSuggestion: () => void;
  dismissSuggestion: () => void;
}

export function useCommitBox({ rootPath, repo, execute }: UseCommitBoxOptions): CommitBoxState {
  const { sessionId } = useSessionStateSnapshot();
  const [message, setMessage] = useSessionState<string>('git.commitDraft', '');
  const [amend, setAmend] = useSessionState<boolean>('git.amend', false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [generated, setGenerated] = useState(false);
  /** Guards a double click while the request is in flight. */
  const generatingRef = useRef(false);
  /** The text this hook seeded, so un-ticking clears only its own write. */
  const seededRef = useRef<string | null>(null);
  // The live draft and checkbox, read inside the async tail without making
  // either an effect dependency (a dependency on `message` would re-fire the
  // read on every keystroke, and the session-state setters are re-minted each
  // render, so depending on those would re-fire it on every render).
  const messageRef = useRef(message);
  messageRef.current = message;
  const amendRef = useRef(amend);
  amendRef.current = amend;
  const setMessageRef = useRef(setMessage);
  setMessageRef.current = setMessage;

  /** The UI's setter: a user edit ends the "generated" state. */
  const setDraft = useCallback(
    (value: string) => {
      setMessage(value);
      setGenerated(false);
    },
    [setMessage],
  );

  const generate = useCallback(() => {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setIsGenerating(true);
    setSuggestion(null);

    const body = {
      ...(rootPath ? { root: rootPath } : {}),
      repo,
      ...(sessionId ? { sessionId } : {}),
      ...(amendRef.current ? { amend: true } : {}),
    };

    void fetch('/api/fs/git-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { message?: unknown; error?: unknown } | null;
        if (!response.ok || typeof payload?.message !== 'string' || !payload.message.trim()) {
          throw new Error(
            typeof payload?.error === 'string' ? payload.error : `Request failed (HTTP ${response.status})`,
          );
        }
        const text = payload.message.trim();
        // A draft the user typed is never overwritten: the answer becomes a
        // suggestion they can accept. An empty box is filled directly.
        if (messageRef.current.trim().length === 0) {
          setMessageRef.current(text);
          setGenerated(true);
        } else {
          setSuggestion(text);
        }
      })
      .catch((error: unknown) => {
        pushToast(error instanceof Error ? error.message : String(error), 'error');
      })
      .finally(() => {
        generatingRef.current = false;
        setIsGenerating(false);
      });
  }, [rootPath, repo, sessionId]);

  const useSuggestion = useCallback(() => {
    if (suggestion === null) return;
    setMessage(suggestion);
    setGenerated(true);
    setSuggestion(null);
  }, [suggestion, setMessage]);

  const dismissSuggestion = useCallback(() => setSuggestion(null), []);

  useEffect(() => {
    if (!amend) return;
    // A draft is already there — the user's, from this session or a restore.
    if (messageRef.current.trim().length > 0) return;

    const params = new URLSearchParams({ headMessage: '1' });
    if (rootPath) params.set('root', rootPath);
    if (repo && repo !== '.') params.set('repo', repo);

    let cancelled = false;
    void fetch(`/api/fs/git?${params.toString()}`)
      .then((res) => res.json())
      .then((body: { message?: string | null } | null) => {
        if (cancelled) return;
        // The user typed, or un-ticked, while the read was in flight.
        if (!amendRef.current || messageRef.current.trim().length > 0) return;
        const text = typeof body?.message === 'string' ? body.message : '';
        if (text.length === 0) return;
        seededRef.current = text;
        setMessageRef.current(text);
      })
      .catch(() => {
        // A failed read is not a failure of the commit: the box keeps its
        // placeholder and the user types the message, exactly as before.
      });

    return () => {
      cancelled = true;
    };
    // The setters are deliberately absent: they are re-minted every render,
    // and the read is keyed to the SCOPE and the tick, not to a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amend, sessionId, rootPath, repo]);

  const toggleAmend = useCallback(
    (next: boolean) => {
      if (next) {
        setAmend(true);
        return;
      }
      if (seededRef.current !== null && messageRef.current === seededRef.current) {
        setMessage('');
      }
      seededRef.current = null;
      setAmend(false);
    },
    [setAmend, setMessage],
  );

  const commit = useCallback(() => {
    execute('commit', undefined, { message: messageRef.current, ...(amendRef.current ? { amend: '1' } : {}) });
    setMessage('');
    setAmend(false);
    seededRef.current = null;
    setSuggestion(null);
    setGenerated(false);
  }, [execute, setAmend, setMessage]);

  return {
    message,
    setMessage: setDraft,
    amend,
    seeded: seededRef.current !== null && message === seededRef.current,
    toggleAmend,
    commit,
    isGenerating,
    suggestion,
    generated,
    generate,
    useSuggestion,
    dismissSuggestion,
  };
}
