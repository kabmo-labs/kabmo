/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Prompt delivery for the live omp bridge: warm the session up, attach the
 * event stream, POST the prompt.
 *
 * The run's `stream` row is written SERVER-side at dispatch
 * (`rpc/session-commands.ts`), and the sidebar and the generating indicator
 * both read it from there. Nothing is armed here: a client-owned mark was a
 * second answer to "is a run in flight", and one whose release depended on the
 * client naming the same session id it armed — which is how a spinner outlived
 * the run it belonged to. Extracted from useOmpAgent so that hook stays under
 * the repo's per-file size ceiling.
 */

import { useCallback } from 'preact/hooks';
import type { Dispatch, SetStateAction } from 'preact/compat';
import { setSessionTitleHint } from '@/client/hooks/chat/omp/sidebar-overlay';
import { redirectToOwningInstance, type SessionOwnerConflict } from '@/client/hooks/chat/omp/owner-redirect';
import type { AgentImage, OmpAgentState, PromptDispatchResult } from '@/shared/types';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';

export interface OmpPromptSenderDeps {
  /** Live session id the prompt targets; the caller mirrors its prop into it. */
  sessionIdRef: { current: string | null };
  /** Attach the event stream to a spawned session. */
  connect: (sessionId: string) => void;
  setState: Dispatch<SetStateAction<OmpAgentState>>;
}

export interface OmpPromptSender {
  sendPrompt: (message: string, images?: AgentImage[], options?: { accessMode?: ApprovalMode }) => Promise<PromptDispatchResult>;
  sendNewPrompt: (
    message: string,
    cwd: string,
    images?: AgentImage[],
    composerOptions?: {
      model?: { provider: string; modelId: string } | null;
      thinkingLevel?: string | null;
      accessMode?: ApprovalMode;
      /** Plan/goal picks made on the pending view. Applied through the spawn
       *  ENVIRONMENT, because a brand-new session has no transcript for the
       *  extension to restore from — see the route's `modes` handling. */
      modes?: { plan: boolean; goal: boolean } | null;
    },
  ) => Promise<{ sessionId: string; model: { provider: string; modelId: string } | null } | null>;
}

export function useOmpPromptSender(deps: OmpPromptSenderDeps): OmpPromptSender {
  const { sessionIdRef, connect, setState } = deps;

  /** Send a prompt to the omp session via the RPC bridge. */
  const sendPrompt = useCallback(async (
    message: string,
    images?: AgentImage[],
    options?: { accessMode?: ApprovalMode },
  ) => {
    const sid = sessionIdRef.current;
    if (!sid) return { ok: false, busy: false, error: 'No session' };
    setState((prev) => ({ ...prev, isGenerating: true, error: null }));
    try {
      // Mirror omp-web handleSend: warm the session process up with get_state
      // (spawns it on first use), then attach the event stream before sending
      // the prompt so no agent events are missed.
      const warmup = await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The mode rides the warmup too: this is the request that lazily spawns
        // an idle session, and omp only accepts --approval-mode at spawn time.
        body: JSON.stringify({
          type: 'get_state',
          ...(options?.accessMode ? { accessMode: options.accessMode } : {}),
        }),
      });
      if (warmup.ok) connect(sid);

      const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'prompt',
          message,
          ...(images?.length ? { images } : {}),
          ...(options?.accessMode ? { accessMode: options.accessMode } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; code?: string } & SessionOwnerConflict;
      if (!res.ok || body.error) {
        // Another Kabmo instance owns this session: send the tab there
        // instead of starting a second writer (which omp would fork).
        if (redirectToOwningInstance(body, sid)) return { ok: false, busy: false, error: 'Session is owned by another instance' };
        setState((prev) => ({ ...prev, isGenerating: false, error: body.error ?? `HTTP ${res.status}` }));
        // `agent_busy`: omp REFUSED the prompt because a turn is still
        // streaming. Nothing was delivered, so the caller may queue it. Every
        // other failure (a timed-out ack, a transport error) may already have
        // been accepted and must never be resent automatically.
        return { ok: false, busy: body.code === 'agent_busy', error: body.error ?? `HTTP ${res.status}` };
      }
      return { ok: true, busy: false };
    } catch (e) {
      setState((prev) => ({ ...prev, isGenerating: false, error: e instanceof Error ? e.message : String(e) }));
      return { ok: false, busy: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [connect, sessionIdRef, setState]);

  /** Spawn a brand-new omp session and send the first prompt: ensure_session
   *  first (returns omp's real session id), attach the event stream, then send
   *  the prompt through the existing session route so no agent events are
   *  missed. Model/thinking picks ride the ensure_session body so omp applies
   *  them BEFORE the first prompt (and their JSONL change entries are written
   *  up front, not after the run starts). Returns the new session id on
   *  success, or null on failure — the caller adopts the id as the active
   *  session. */
  const sendNewPrompt = useCallback(async (
    message: string,
    cwd: string,
    images?: AgentImage[],
    composerOptions?: {
      model?: { provider: string; modelId: string } | null;
      thinkingLevel?: string | null;
      accessMode?: ApprovalMode;
      modes?: { plan: boolean; goal: boolean } | null;
    },
  ): Promise<{ sessionId: string; model: { provider: string; modelId: string } | null } | null> => {
    setState((prev) => ({ ...prev, isGenerating: true, error: null }));
    // The real id does not exist until `ensure_session` answers, so the mark
    // can only be armed past that point — the spawn itself is covered by the
    // pending view, and nothing on the sidebar can name the session yet.
    let sid: string | null = null;
    try {
      const created = await fetch('/api/agent/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'ensure_session',
          cwd,
          ...(composerOptions?.model ? composerOptions.model : {}),
          ...(composerOptions?.thinkingLevel ? { thinkingLevel: composerOptions.thinkingLevel } : {}),
          ...(composerOptions?.accessMode ? { accessMode: composerOptions.accessMode } : {}),
          // Plan/goal picks from the pending view. Omitted when the user made
          // none, so a spawn with no selection behaves exactly as before.
          ...(composerOptions?.modes ? { modes: composerOptions.modes } : {}),
        }),
      });
      const createdBody = (await created.json().catch(() => ({}))) as {
        success?: boolean;
        sessionId?: string;
        model?: { provider: string; modelId: string } | null;
        error?: string;
      };
      if (!created.ok || !createdBody.sessionId) {
        setState((prev) => ({ ...prev, isGenerating: false, error: createdBody.error ?? `HTTP ${created.status}` }));
        return null;
      }
      sid = createdBody.sessionId;
      connect(sid);
      // Name the sidebar's placeholder row with what the user actually sent:
      // omp's own title is ~17s away (it writes the session file only at the
      // first assistant message), so until then the row would read
      // `New Session - <clock>`. A hint only — the real row supersedes it.
      setSessionTitleHint(sid, message);
      const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'prompt',
          message,
          ...(images?.length ? { images } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || body.error) {
        setState((prev) => ({ ...prev, isGenerating: false, error: body.error ?? `HTTP ${res.status}` }));
        return null;
      }
      return { sessionId: sid, model: createdBody.model ?? null };
    } catch (e) {
      setState((prev) => ({ ...prev, isGenerating: false, error: e instanceof Error ? e.message : String(e) }));
      return null;
    }
  }, [connect, setState]);

  return { sendPrompt, sendNewPrompt };
}
