/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where a mode marker is intercepted.
 *
 * The extension reports every plan/goal transition through `ctx.ui.notify`, and
 * omp frames that as an `extension_ui_request` with `method: "notify"` — NOT a
 * `notice` frame (verified against omp 18.4.4: `rpc-mode.ts`'s `notify`
 * implementation emits exactly that shape). Intercepting the wrong frame type
 * left the markers reaching the DIALOG path, which painted a modal for a mode
 * toggle and never reached the composer's state hook.
 */

import { describe, expect, test } from 'bun:test';
import { foldAgentEvent, type OmpAgentFoldDeps } from '@/shared/lib/chat/omp/agent-events';
import { KABMO_MODE_SIGNAL } from '@/shared/lib/omp/mode/client-signal';
import { subscribeClientSignal } from '@/client/lib/signals';
import type { OmpAgentEvent } from '@/shared/types/omp/agent';

function makeDeps(sessionId: string, events: unknown[]): OmpAgentFoldDeps {
  const state = { isGenerating: false, error: null } as Record<string, unknown>;
  return {
    sessionId,
    setState: (updater: unknown) => {
      if (typeof updater === 'function') Object.assign(state, (updater as (prev: unknown) => unknown)(state));
    },
    activityRef: { current: '' },
    providerRetryVerbRef: { current: null },
    currentThinkingLevelRef: { current: undefined },
    toolResultsRef: { current: new Map() },
    fileMutatingCallsRef: { current: new Set() },
    lastToolMessageRef: { current: null },
    callbacksRef: {
      current: {
        onExtensionUiRequest: (request: unknown) => events.push({ kind: 'dialog', request }),
      },
    },
  } as unknown as OmpAgentFoldDeps;
}

describe('mode markers', () => {
  test('a CURRENT marker becomes a mode signal, not a dialog', () => {
    const seen: unknown[] = [];
    const signals: unknown[] = [];
    const unsubscribe = subscribeClientSignal(KABMO_MODE_SIGNAL, (payload) => { signals.push(payload); });

    try {
      foldAgentEvent(
        {
          type: 'extension_ui_request',
          id: 'x0',
          method: 'notify',
          message: 'KABMO_PLAN_STATE:{"enabled":true}',
        } as OmpAgentEvent,
        makeDeps('s1', seen),
      );
      expect(seen).toHaveLength(0);
      expect(signals).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  });

  test('a notify frame carrying a pre-rename marker becomes a mode signal, not a dialog', () => {
    const seen: unknown[] = [];
    const signals: unknown[] = [];
    const unsubscribe = subscribeClientSignal(KABMO_MODE_SIGNAL, (payload) => { signals.push(payload); });

    try {
      const deps = makeDeps('s1', seen);
      foldAgentEvent(
        {
          type: 'extension_ui_request',
          id: 'x1',
          method: 'notify',
          message: 'CHAMBER_PLAN_STATE:{"enabled":true}',
        } as OmpAgentEvent,
        deps,
      );
      expect(seen).toHaveLength(0);
      expect(signals).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  });

  test('an ordinary notify still reaches the dialog path', () => {
    const seen: unknown[] = [];
    foldAgentEvent(
      { type: 'extension_ui_request', id: 'x2', method: 'notify', message: 'Reloaded omp engine' } as OmpAgentEvent,
      makeDeps('s1', seen),
    );
    expect(seen).toHaveLength(1);
  });

  test('a marker whose payload is broken falls through as an ordinary notify', () => {
    const seen: unknown[] = [];
    foldAgentEvent(
      { type: 'extension_ui_request', id: 'x3', method: 'notify', message: 'CHAMBER_PLAN_STATE:{broken' } as OmpAgentEvent,
      makeDeps('s1', seen),
    );
    expect(seen).toHaveLength(1);
  });

  test('a non-notify extension request is untouched', () => {
    const seen: unknown[] = [];
    foldAgentEvent(
      { type: 'extension_ui_request', id: 'x4', method: 'select', title: 'Pick', options: ['a'] } as OmpAgentEvent,
      makeDeps('s1', seen),
    );
    expect(seen).toHaveLength(1);
  });
});
