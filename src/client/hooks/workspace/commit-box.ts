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

import { useCallback, useEffect, useRef } from 'preact/hooks';
import { useSessionState, useSessionStateSnapshot } from '@/client/hooks/workspace/session-state';

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
}

export function useCommitBox({ rootPath, repo, execute }: UseCommitBoxOptions): CommitBoxState {
  const { sessionId } = useSessionStateSnapshot();
  const [message, setMessage] = useSessionState<string>('git.commitDraft', '');
  const [amend, setAmend] = useSessionState<boolean>('git.amend', false);
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
  }, [execute, setAmend, setMessage]);

  return { message, setMessage, amend, seeded: seededRef.current !== null && message === seededRef.current, toggleAmend, commit };
}
