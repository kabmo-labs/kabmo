/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Session loading core for Kabmo chat: fetches /api/chat/:sessionId,
 * applies session metadata (model / thinking level / title) and replaces the
 * timeline with the committed messages. Extracted from useChatTimeline so that
 * hook stays under the size ceiling.
 *
 * Reload-mid-stream contract: the timeline fetch must NOT depend on the
 * generating flag alone. On a page reload during a run there is no optimistic
 * bubble yet (fresh mount, refs are null), so the committed JSONL history —
 * including the already-finalized turns of the in-flight run — must load
 * normally; the stream resume continues from there. Clobbering is only possible
 * while a run THIS PAGE dispatched owns the timeline (`ownRunRef`).
 */

import type { Dispatch, RefObject, SetStateAction } from 'preact/compat';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import type { ChatMessageData } from '@/shared/types';
import { SESSION_META_RETRY_SCHEDULE_MS } from '@/shared/lib/workspace/refresh-cadence';
import { useSessionPagination } from '@/client/hooks/chat/timeline/session-pagination';
import { useLostRunRecovery } from '@/client/hooks/chat/timeline/lost-run';

export interface SessionDataShape {
  id?: string;
  title?: string;
  model?: string | { provider: string; modelId: string };
  thinkingLevel?: string;
  messages?: any[];
}

/** Session identity a spawn established before omp's JSONL is readable. */
export interface SessionSeed {
  model?: { provider: string; modelId: string } | null;
  thinkingLevel?: string | null;
}

export interface UseSessionLoadDeps {
  sessionId: string | null;
  setLocalMessages: Dispatch<SetStateAction<ChatMessageData[]>>;
  setGenerating: (v: boolean) => void;
  /** Live generating flag written by the caller's `setGenerating` throat. Gates
   *  the seeded-model fallback and the session-switch reset. */
  isGeneratingRef: { current: boolean };
  /** Whether the run in flight is one THIS PAGE dispatched. Only then does the
   *  live stream own the row list and a committed fetch get skipped; a run
   *  adopted from a live session (a reload mid-run, a second tab, a scheduled
   *  task) must still load its history — the probe that resumes the generating
   *  UI sets `isGeneratingRef` too, and treating that as ownership discarded
   *  the whole transcript, leaving an empty timeline over a running session. */
  ownRunRef: { current: boolean };
  /** The stream has announced the run in flight (see `streamRunRef`). */
  streamRunRef: { current: boolean };
  /** The SERVER reports a run for this session (the `stream` row). Together
   *  with `streamRunRef` this is the evidence the reconnect recovery needs: a
   *  run whose FIRST frame was lost has no `agent_start` on this client. */
  serverRunRef: { current: boolean };
  /** Live AI placeholder ref: the row the streaming answer is filling. Read on
   *  a session switch (cleared with the optimistic user id) and by the stream
   *  callbacks; it is NOT the timeline-ownership signal — the placeholder is
   *  released at the first assistant `message_end` while the run continues. */
  aiPlaceholderIdRef: { current: string | null };
  /** Live optimistic user bubble ref: cleared together with the placeholder on
   *  a session switch so stale ids cannot survive into the next session. */
  optimisticUserIdRef: { current: string | null };
  /** Raw composer text of steer/follow-up turns awaiting omp's echo. Cleared
   *  when a lost run is settled, or a later echo could be re-labelled with an
   *  earlier message's text. */
  pendingUserDisplaysRef: { current: { sent: string; display: string }[] };
  /** Drop queued stream updates belonging to the previous session (coalescer). */
  cancelStreamingCoalescer: () => void;
  metaRefreshedRef: { current: string | null };
  /** Scroll container of the timeline: lets loadOlder preserve the viewport
   *  position when older rows are prepended above it. */
  scrollRef?: RefObject<HTMLDivElement>;
  /** Scroll hook's bottom-jump guard and counter, forwarded to the pagination
   *  hook: a jump to the tail outranks an in-flight older window. */
  jumpActiveRef?: RefObject<boolean>;
  jumpCountRef?: RefObject<number>;
}

export function useSessionLoad(deps: UseSessionLoadDeps) {
  const { sessionId, setLocalMessages, setGenerating, isGeneratingRef, ownRunRef, streamRunRef, serverRunRef, aiPlaceholderIdRef, optimisticUserIdRef, pendingUserDisplaysRef, cancelStreamingCoalescer, metaRefreshedRef, scrollRef, jumpActiveRef, jumpCountRef } = deps;

  const [sessionData, setSessionData] = useState<SessionDataShape | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const prevSessionIdRef = useRef<string | null>(null);
  // Real session id adopted by a fresh spawn ("new-…" → UUID). onAgentStart
  // may fire before React re-renders with the new URL, so it reads the id
  // from here instead of the (still-stale) sessionId prop.
  const adoptedSessionIdRef = useRef<string | null>(null);
  // Model seeded from the spawn response; kept until the JSONL writes model_change.
  const seededModelRef = useRef<{ provider: string; modelId: string } | null>(null);
  // Thinking level seeded from the spawn response. The spawn's
  // `set_thinking_level` IS the level this session runs, and `/api/chat/:id`
  // cannot report it until omp's JSONL is locatable — until then the loader
  // answers from Kabmo DB copy, which carries no thinkingLevel at all.
  // Without this seed the composer that takes over the pending view falls back
  // to a catalog default and claims a level the run never used.
  const seededThinkingLevelRef = useRef<string | null>(null);

  const applySessionData = useCallback((incoming: SessionDataShape) => {
    if (incoming.model && typeof incoming.model === 'object') seededModelRef.current = incoming.model;
    const model = incoming.model ?? (isGeneratingRef.current ? seededModelRef.current ?? undefined : undefined);
    const thinkingLevel = incoming.thinkingLevel ?? seededThinkingLevelRef.current ?? undefined;
    setSessionData({ ...incoming, model, thinkingLevel });
  }, []);

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // Older-window pagination (cursor, retry flag, scroll anchoring) lives in its
  // own hook so this one stays under the repo's per-file size ceiling.
  const { hasMore, loadingOlder, loadOlderError, loadOlder, jumpToTurn, resetPages, applyWindow } = useSessionPagination({
    sessionId,
    sessionIdRef,
    setLocalMessages,
    scrollRef,
    jumpActiveRef,
    jumpCountRef,
  });

  /** Re-fetch the session's title/metadata after the omp JSONL has been
   *  written (spawn or agent end) so the navbar and context panel show the
   *  real session title instead of the default. Retries on a front-loaded
   *  backoff until the JSONL actually carries messages (omp writes the user
   *  turn on agent start). */
  const refreshSessionMeta = useCallback((sid: string) => {
    // The URL lags the adopted id right after a fresh spawn, so accept either.
    const isActive = () => sessionIdRef.current === sid || adoptedSessionIdRef.current === sid;
    if (!isActive()) return;
    let attempt = 0;
    const tryFetch = () => {
      if (!isActive()) return;
      fetch(`/api/chat/${encodeURIComponent(sid)}`)
        .then(res => res.json())
        .then(data => {
          if (!data?.session || !isActive()) return;
          applySessionData(data.session);
          // A settled read (one that actually carries messages) is the last
          // attempt: the sidebar follows the realtime topics, so nothing here
          // needs to signal it.
          if ((data.session.messages?.length ?? 0) > 0) return;
          const delay = SESSION_META_RETRY_SCHEDULE_MS[attempt];
          attempt += 1;
          if (delay !== undefined) setTimeout(tryFetch, delay);
        })
        .catch(() => {});
    };
    tryFetch();
  }, [applySessionData]);

  /** Adopt a spawn's session identity: the model and the thinking level the
   *  first prompt is running with. Only the fields a caller supplies are
   *  written, so a null model/level leaves the previous value untouched. */
  const seedSession = useCallback((seed: SessionSeed) => {
    if (seed.model) seededModelRef.current = seed.model;
    if (seed.thinkingLevel) seededThinkingLevelRef.current = seed.thinkingLevel;
    setSessionData(prev => ({
      ...(prev ?? {}),
      ...(seed.model ? { model: seed.model } : {}),
      ...(seed.thinkingLevel ? { thinkingLevel: seed.thinkingLevel } : {}),
    }));
  }, []);

  /** Whether the LIVE timeline owns the row list: a run THIS PAGE dispatched is
   *  in flight, so the rows on screen are the stream's, not a committed
   *  snapshot's.
   *
   *  A committed fetch is a LAGGING snapshot while a run is live. For a fresh
   *  spawn there may be no transcript on disk at all (omp buffers its writes
   *  until the first assistant message settles), and it never carries a segment
   *  still streaming. Applying one mid-run costs the operator their own turn —
   *  measured: an empty payload emptied the list, and a payload carrying the
   *  file's own copy of that turn was merged UNDER the live rows, whose ids
   *  differ, so the turn rendered twice.
   *
   *  Keyed on the RUN THIS PAGE STARTED, never on `isGeneratingRef` alone: the
   *  mount probe that resumes a live run sets that flag too, so keying on it
   *  made OPENING a streaming session discard its whole committed transcript
   *  (measured: 0 rows, only a "Load earlier messages" button). An adopted run
   *  must still load its history; the resume continues from there. */
  const timelineOwnedByLiveRun = useCallback(
    () => ownRunRef.current && isGeneratingRef.current,
    [isGeneratingRef, ownRunRef],
  );

  /** Session metadata for a run whose transcript is not readable yet: the
   *  spawn's own seed. `/api/chat/:id` answers with no `model` for a freshly
   *  spawned session (it reads the JSONL's `model_change` entry, which omp has
   *  not written), so replacing `sessionData` with null there blanked the
   *  generating indicator's provider/model for the whole first run. Null when
   *  nothing was seeded or no run is in flight. */
  const seededSessionData = useCallback(
    (): SessionDataShape | null =>
      isGeneratingRef.current && seededModelRef.current ? { model: seededModelRef.current } : null,
    [isGeneratingRef],
  );

  // A channel that comes back after the run's `message_end`/`agent_end` were
  // lost with it: the timeline holds the stream's last partial segment and
  // nothing else will ever finalize it (see `lost-run.ts`). A run that is
  // STILL LIVE at reconnect is left alone here, but its lost segments are
  // remembered and re-read when it settles.
  const { reloadMessages, needsReloadRef } = useLostRunRecovery({
    sessionId,
    sessionIdRef,
    adoptedSessionIdRef,
    isGeneratingRef,
    streamRunRef,
    serverRunRef,
    setGenerating,
    setLocalMessages,
    applyWindow,
    aiPlaceholderIdRef,
    optimisticUserIdRef,
    pendingUserDisplaysRef,
    cancelStreamingCoalescer,
  });

  // Fetch session messages and details from API
  useEffect(() => {
    let active = true;
    setSessionLoading(true);
    // Track the previous session id so a session switch (including "New
    // Session" → new-…) clears the timeline, while the optimistic spawn
    // transition (new-… → real UUID) keeps its bubbles.
    if (sessionId !== prevSessionIdRef.current) {
      const isSpawnAdopt = sessionId && !sessionId.startsWith('new-') && prevSessionIdRef.current?.startsWith('new-');
      // Keep the optimistic bubbles while a local send is in flight and this
      // session is the one it spawned (a fresh spawn may not have passed
      // through "new-…"). A reload mid-run has no adopted id, so history loads.
      const isAdoptingInFlight = isGeneratingRef.current && adoptedSessionIdRef.current === sessionId;
      if (!isSpawnAdopt && !isAdoptingInFlight) {
        setLocalMessages([]);
        setGenerating(false);
        adoptedSessionIdRef.current = null;
        seededModelRef.current = null;
        // Metadata (model / thinking level) belongs to ONE session: leaving it
        // in place let a pending "new-…" composer — and any other session's
        // composer — display a level that session never ran with, until the
        // fetch replaced it.
        setSessionData(null);
        // The thinking seed belongs to the previous session's spawn; keeping it
        // would report that level for the newly opened session.
        seededThinkingLevelRef.current = null;
        // The placeholder/optimistic ids belong to the PREVIOUS session's
        // in-flight send; message_end never arrives after a switch away (the
        // stream is disconnected), so they must be dropped here. A stale
        // placeholder would let the next session's stream reconcile into a row
        // that is no longer on screen. (`setGenerating(false)` above releases
        // the run ownership this page held — the guard reads `ownRunRef`, so a
        // stale value there is what used to discard a mid-run session's
        // committed history on return.)
        aiPlaceholderIdRef.current = null;
        optimisticUserIdRef.current = null;
        // Drop coalesced message_update frames queued by the previous
        // session's stream: otherwise they apply to this (cleared) timeline
        // as phantom bubbles.
        cancelStreamingCoalescer();
      }
      // Reset pagination cursor on every session switch — the window belongs
      // to the previous session otherwise.
      resetPages();
      // metaRefreshedRef must NOT survive a session switch — including a
      // spawn adoption. It is the once-per-session guard in onAgentStart
      // (omp-callbacks.ts); keeping the stale value here ate the retrigger,
      // so a title refresh that landed before the omp JSONL had messages
      // (default timestamped title) never ran again and the sidebar stayed
      // on the placeholder until some later event refreshed it.
      metaRefreshedRef.current = null;
      prevSessionIdRef.current = sessionId;
    }
    if (sessionId) {
      // Ownership is read at BOTH ends of the flight, never at resolve alone.
      // A run this page started can END between the two — measured on a real CI
      // run: the fetch was issued mid-run (`ownRunRef` true), `agent_end`
      // landed, and the response arrived ~1 ms later carrying `messages: []`
      // because omp had not flushed its JSONL yet. Reading the guard at resolve
      // alone saw no run and emptied the timeline, discarding the turn that had
      // just streamed. The mirror case is just as real: a fetch issued BEFORE a
      // run started carries the pre-run transcript, and applying it would wipe
      // the optimistic rows the send just mounted. Either end owning the rows
      // means this payload is a lagging snapshot of a timeline the stream owns.
      const ownedAtIssue = timelineOwnedByLiveRun();
      const ownedByLiveRun = () => ownedAtIssue || timelineOwnedByLiveRun();
      fetch(`/api/chat/${sessionId}`)
        .then(res => res.json())
        .then(data => {
          if (!active) return;
          setSessionLoading(false);
          if (data?.session) {
            applySessionData(data.session);
            const fetched = data.session.messages || [];
            // Never replace, never merge, never empty while the stream owns the
            // rows: a committed fetch is a lagging snapshot and applying one
            // mid-run either empties the list or renders a second copy of the
            // operator's turn (see `timelineOwnedByLiveRun`).
            if (!ownedByLiveRun()) {
              if (fetched.length > 0) setLocalMessages(fetched);
              // A pending "new-…" session has nothing committed by definition.
              else if (!sessionId.startsWith('new-')) setLocalMessages([]);
            }
            applyWindow(data.hasMore, data.oldestIndex);
          } else {
            setSessionData(seededSessionData());
            if (!ownedByLiveRun()) setLocalMessages([]);
          }
        })
        .catch(err => {
          console.error('Error loading session from API:', err);
          if (active) setSessionLoading(false);
          if (active && !ownedByLiveRun()) {
            setSessionData(seededSessionData());
            setLocalMessages([]);
          }
        });
    } else {
      setSessionData(null);
      setLocalMessages([]);
    }
    return () => {
      active = false;
    };
    // sessionModel identity flows through applySessionData; the effect only
    // re-runs on session switches by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, applySessionData, timelineOwnedByLiveRun, seededSessionData, setLocalMessages, setGenerating]);

  return {
    sessionData,
    hasMore,
    loadingOlder,
    loadOlderError,
    sessionLoading,
    loadOlder,
    jumpToTurn,
    adoptedSessionIdRef,
    refreshSessionMeta,
    seedSession,
    reloadMessages,
    needsReloadRef,
  };
}
