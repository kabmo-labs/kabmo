/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The frames omp sends about the TRANSPORT and the EXTENSIONS, rather than
 * about the conversation.
 *
 * Each of these would otherwise fall through the fold's `default:` silently,
 * and silence is the wrong answer for all three: a dropped frame is a missing
 * step in the transcript, a failed extension is a broken tool the user cannot
 * see, and a settled session is the moment the optimistic generating state must
 * be released.
 *
 * Split out of `agent-events.ts` so that file stays under the repo's per-file
 * size ceiling — the same seam `tool-results.ts` and `terminal-messages.ts`
 * draw. The host is a narrow structural view of the fold's deps, not the deps
 * type itself, so neither module imports the other.
 */

import type { OmpAgentEvent } from '@/shared/types';
import type { OmpAgentFoldDeps } from '@/shared/lib/chat/omp/fold-deps';
import { endRetrySaga } from '@/shared/lib/chat/timeline/provider-retry';

export interface TransportFrameHost {
  foldDeps: OmpAgentFoldDeps;
}

/**
 * Fold one transport/extension frame. Returns false when the frame is not one
 * of these, so the caller's own switch can continue.
 */
export function foldTransportFrame(data: OmpAgentEvent, host: TransportFrameHost): boolean {
  const callbacks = host.foldDeps.callbacksRef.current;
  switch (data.type) {
    // An event could not fit the transport and omp DROPPED it. Without this
    // the loss is invisible: the timeline simply never shows what the frame
    // carried, and the run looks like it skipped a step. omp names the original
    // frame type, so the notice can say which one went missing.
    case 'rpc_frame_error': {
      const original = typeof data.originalType === 'string' ? data.originalType : 'an event';
      callbacks?.onNotice?.('warning', `OMP dropped a ${original} frame: it exceeded the transport limit.`);
      return true;
    }

    // An extension threw while handling an event. omp keeps the session alive,
    // so this is the ONLY place the failure surfaces.
    case 'extension_error': {
      const path = typeof data.extensionPath === 'string' ? data.extensionPath : 'an extension';
      const detail = typeof data.error === 'string' ? data.error : 'unknown error';
      callbacks?.onNotice?.('warning', `${path} failed: ${detail}`);
      return true;
    }

    // The session went quiet — nothing live, admitted, scheduled, queued or
    // awaiting background work. The server already releases the `stream` row
    // from its own `get_state.isSettled` probe; this frame is the same verdict
    // arriving on the wire, so the client releases its optimistic generating
    // state without waiting for the sidebar's next poll.
    case 'session_settled':
      endRetrySaga(host.foldDeps);
      host.foldDeps.setState((prev) => (prev.isGenerating ? { ...prev, isGenerating: false } : prev));
      return true;

    // `cache_warming_*`, `retry_fallback_*`, `config_warnings_changed`,
    // `ttsr_triggered`, `todo_reminder`, `todo_auto_clear`, `irc_message`,
    // `tool_stream_update` and the newer surfaces carry no Kabmo-side effect,
    // and are listed here so the omission is a decision rather than an
    // oversight: warming and fallback are already named by `auto_retry_*` /
    // `model_changed`, the todo frames describe a list the Todo panel reads from
    // its own topic, IRC is not a Kabmo surface, and `tool_stream_update` is a
    // tool's own projection of a call whose arguments the card already reads
    // from `toolcall_delta`. The advisor / live-voice / `queue_update` /
    // `config_update` frames (omp 18.9+) are the same kind of no-op here.
    case 'cache_warming_start':
    case 'cache_warming_end':
    case 'retry_fallback_applied':
    case 'retry_fallback_succeeded':
    case 'config_warnings_changed':
    case 'ttsr_triggered':
    case 'todo_reminder':
    case 'todo_auto_clear':
    case 'irc_message':
    case 'tool_stream_update':
    case 'advisor_yielded':
    case 'advisor_cost_changed':
    case 'queue_update':
    case 'config_update':
      return true;

    default:
      return false;
  }
}
