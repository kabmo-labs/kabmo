/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The live omp agent bridge over the unified realtime channel.
 *
 * The session's frames now arrive on the `session:<id>` topic, so the bridge's
 * contract is about the TOPIC, not about dialing a socket of its own. What each
 * case pins is a way the bridge could lie to the timeline:
 *
 * - subscribing is safe before the session's omp child exists: the snapshot is
 *   `running:false`, and the spawn path re-snapshots the topic once the child is
 *   reachable — the case the old 409-refusal workaround existed to dodge;
 * - every DELTA reaches the shared fold (`agent_start` must flip
 *   `isGenerating`), because the topic is an event stream: a client that kept
 *   only the latest payload would drop the run;
 * - the SNAPSHOT is the reattach payload: it decides whether to resume the
 *   generating UI and replays the ask/approval dialogs omp never re-emits;
 * - a session switch releases the previous subscription, or the timeline keeps
 *   folding another session's frames.
 *
 * Driven through a REAL server and socket: the frames are the hub's, and a
 * stubbed WebSocket would only prove the stub's timing.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact/compat';
import { act } from 'preact/test-utils';

import { useOmpAgentStream } from '@/client/hooks/chat/omp/stream';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { sessionTopic } from '@/shared/lib/realtime/protocol';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';
import type { ChatMessageData, OmpAgentCallbacks, OmpAgentState } from '@/shared/types';


let container: HTMLElement | undefined;

function installDom(origin: string): void {
  installDomGlobals(new Window({ url: origin }));
}

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
  resetRealtimeClient();
});

afterAll(() => {
  restoreDomGlobals();
});



const EMPTY_STATE: OmpAgentState = { isGenerating: false, connected: false, error: null };

interface StreamApi {
  connect: (sessionId: string) => void;
  disconnect: () => void;
}

interface Harness {
  server: RealtimeTestServer;
  api: () => StreamApi;
  state: () => OmpAgentState;
  calls: string[];
}

/** Mount the real stream hook against a real realtime server. */
async function mountStream(snapshot: unknown): Promise<Harness> {
  const server = await startRealtimeTestServer(new Map<string, TopicResolver>([
    [sessionTopic('s1'), async () => snapshot],
    [sessionTopic('s2'), async () => snapshot],
  ]));
  installDom(`http://127.0.0.1:${server.port}`);

  const seen: { api: StreamApi | null } = { api: null };
  const state: { current: OmpAgentState } = { current: EMPTY_STATE };
  const calls: string[] = [];

  function Probe() {
    const [next, setState] = useState<OmpAgentState>(EMPTY_STATE);
    const callbacksRef = useRef<OmpAgentCallbacks>({
      onConnected: () => { calls.push('connected'); },
      onResumeStream: () => { calls.push('resume'); },
      onExtensionUiRequest: (request) => { calls.push(`dialog:${request.id}`); },
    });
    state.current = next;
    seen.api = useOmpAgentStream({
      setState,
      callbacksRef,
      toolResultsRef: useRef(new Map()) as RefObject<Map<string, never>>,
      lastToolMessageRef: useRef<ChatMessageData | null>(null),
      activityRef: useRef(''),
      currentThinkingLevelRef: useRef<string | undefined>(undefined),
      providerRetryVerbRef: useRef<string | null>(null),
    });
    return null;
  }

  container ??= document.body.appendChild(document.createElement('div'));
  await act(async () => { render(h(Probe, null), container as HTMLElement); });
  return { server, api: () => seen.api as StreamApi, state: () => state.current, calls };
}

/** Wait until the client holds a value for `topic`, then flush Preact. */
async function settleTopic(server: RealtimeTestServer, topic: string): Promise<void> {
  await server.waitForTopic(topic, (value) => value !== null);
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

describe('useOmpAgentStream over the session topic', () => {
  test('a session with no child subscribes cleanly and reports disconnected state', async () => {
    const probe = await mountStream({ running: false });
    await act(async () => { probe.api().connect('s1'); });
    await settleTopic(probe.server, sessionTopic('s1'));

    // Subscribing must NOT be refused: there is simply nothing running yet.
    expect(probe.state().connected).toBe(true);
    expect(probe.state().isGenerating).toBe(false);
    expect(probe.calls).toEqual(['connected']);
    probe.server.stop();
  });

  test('folds every delta frame into agent state', async () => {
    const probe = await mountStream({ running: true, state: { isStreaming: true } });
    await act(async () => { probe.api().connect('s1'); });
    await settleTopic(probe.server, sessionTopic('s1'));

    await act(async () => {
      probe.server.publish(sessionTopic('s1'), { type: 'agent_start' });
      await probe.server.waitForTopic(sessionTopic('s1'), (value) => (value as { type?: string } | null)?.type === 'agent_start');
    });
    expect(probe.state().isGenerating).toBe(true);
    probe.server.stop();
  });

  test('a live snapshot resumes the generating UI and replays blocked dialogs', async () => {
    const probe = await mountStream({
      running: true,
      state: { isStreaming: true },
      pendingUiRequests: [{ id: 'ask-1' }],
    });
    await act(async () => { probe.api().connect('s1'); });
    await settleTopic(probe.server, sessionTopic('s1'));

    expect(probe.calls).toEqual(['connected', 'resume', 'dialog:ask-1']);
    probe.server.stop();
  });

  test('a finished snapshot reattaches without resuming', async () => {
    const probe = await mountStream({ running: true, state: { isStreaming: false, isPromptRunning: false } });
    await act(async () => { probe.api().connect('s1'); });
    await settleTopic(probe.server, sessionTopic('s1'));

    expect(probe.calls).toEqual(['connected']);
    expect(probe.state().isGenerating).toBe(false);
    probe.server.stop();
  });

  test('a `busy` snapshot with no run must NOT resume the generating UI', async () => {
    // The server sets `busy` for a probe that would queue behind work already in
    // flight — including a live subagent whose parent turn has ended. Reading it
    // as "a run is in flight" drew `•Thinking…` over a finished session and only
    // released it when the subagent went stale (SUBAGENT_STALE_MS, 30 min).
    const probe = await mountStream({
      running: true,
      busy: true,
      state: { isStreaming: false, isPromptRunning: false },
    });
    await act(async () => { probe.api().connect('s1'); });
    await settleTopic(probe.server, sessionTopic('s1'));

    expect(probe.calls).toEqual(['connected']);
    expect(probe.state().isGenerating).toBe(false);
    probe.server.stop();
  });

  test('reconnecting to another session releases the previous subscription', async () => {
    const probe = await mountStream({ running: false });
    await act(async () => { probe.api().connect('s1'); });
    await settleTopic(probe.server, sessionTopic('s1'));

    await act(async () => { probe.api().connect('s2'); });
    await settleTopic(probe.server, sessionTopic('s2'));

    // A frame on the RELEASED topic must not reach the fold any more.
    const before = probe.state().isGenerating;
    await act(async () => {
      probe.server.publish(sessionTopic('s1'), { type: 'agent_start' });
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(probe.state().isGenerating).toBe(before);
    probe.server.stop();
  });

  test('disconnect releases the subscription', async () => {
    const probe = await mountStream({ running: true, state: { isStreaming: true } });
    await act(async () => { probe.api().connect('s1'); });
    await settleTopic(probe.server, sessionTopic('s1'));

    await act(async () => { probe.api().disconnect(); });
    expect(probe.state().connected).toBe(false);

    const before = probe.state().isGenerating;
    await act(async () => {
      probe.server.publish(sessionTopic('s1'), { type: 'agent_start' });
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(probe.state().isGenerating).toBe(before);
    probe.server.stop();
  });
});
