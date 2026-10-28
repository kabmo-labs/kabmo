/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether a model-picker section (a provider, FAVORITES, RECENT) is collapsed,
 * remembered per session.
 *
 * The state used to live in a `useState` inside `ModelDropdown`, so a reload —
 * the exact restart the stale-list bug forced — or a session switch reset every
 * section, and a reader who had folded the providers they never use had to fold
 * them again. It is a preference about a list, which is what `session_ui_state`
 * holds (the same slot family `chat.toolOpen` uses).
 *
 * The provider is read OPTIONALLY, the way `useScrollRestore` reads it: the
 * composer's unit tests mount `ModelDropdown` without a `SessionStateProvider`
 * (the provider's own load kicks a realtime reconnect that outlives those
 * files), and a null context makes this hook inert — the store APIs take a
 * null session and do nothing — rather than throwing from a component that
 * has no blob to persist into.
 */

import { useCallback, useContext, useEffect, useState } from 'preact/hooks';
import { SessionStateContext } from '@/client/hooks/workspace/session-state/context';
import { getSessionValue, setSessionKey } from '@/shared/lib/workspace/session-state/store';
import { subscribeSessionReplaced } from '@/shared/lib/workspace/session-state/listeners';

/** Session slot holding `{ [section]: collapsed }` for the model picker. */
export const MODEL_DROPDOWN_COLLAPSED_KEY = 'chat.modelDropdownCollapsed';

export function useCollapsedSections(): [Record<string, boolean>, (section: string) => void] {
  const context = useContext(SessionStateContext);
  const sessionId = context?.sessionId ?? null;
  const ready = context?.ready ?? false;

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    sessionId
      ? (getSessionValue<Record<string, boolean>>(sessionId, MODEL_DROPDOWN_COLLAPSED_KEY) ?? {})
      : {},
  );

  // Restore the stored value once the session's blob landed (or reset to
  // empty for a session that never stored one). The initial useState already
  // read the store; this catches the load landing after the first render.
  useEffect(() => {
    if (!ready || !sessionId) return;
    setCollapsed(getSessionValue<Record<string, boolean>>(sessionId, MODEL_DROPDOWN_COLLAPSED_KEY) ?? {});
  }, [sessionId, ready]);

  // The store replaced this session's blob under the copy (a load landing, an
  // adoption migrate, a delete) — re-read on the event, same as `useSessionState`.
  useEffect(() => {
    if (!sessionId) return;
    return subscribeSessionReplaced(sessionId, () => {
      setCollapsed(getSessionValue<Record<string, boolean>>(sessionId, MODEL_DROPDOWN_COLLAPSED_KEY) ?? {});
    });
  }, [sessionId]);

  const toggleSection = useCallback(
    (section: string) => {
      setCollapsed(prev => {
        const next = { ...prev, [section]: !prev[section] };
        setSessionKey(sessionId, MODEL_DROPDOWN_COLLAPSED_KEY, next);
        return next;
      });
    },
    [sessionId],
  );

  return [collapsed, toggleSection];
}