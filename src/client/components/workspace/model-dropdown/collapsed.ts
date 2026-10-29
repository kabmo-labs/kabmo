/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether a model-picker section (a provider, FAVORITES, RECENT) is collapsed,
 * as a preference shared by every chat.
 *
 * The state used to live in a `useState` inside `ModelDropdown`, so a reload
 * reset every section. It then moved into the session UI blob
 * (`chat.modelDropdownCollapsed`), which fixed the reload but made the fold
 * belong to one chat: a new chat — and every session that had never stored a
 * map — opened fully expanded, so a reader who had folded the providers they
 * never use had to fold them again in each new conversation. It is a preference
 * about the list, not about a session, and it now lives beside the other global
 * UI preferences (`app_settings`).
 *
 * The provider is read OPTIONALLY, the way `useScrollRestore` reads it: the
 * composer's unit tests mount `ModelDropdown` without a `SessionStateProvider`
 * (the provider's own load kicks a realtime reconnect that outlives those
 * files). Only the one-time adoption of a fold an older build stored per
 * session needs it, and a null context makes that step inert instead of
 * throwing from a component that has no blob to migrate.
 */

import { useCallback, useContext, useEffect, useState } from 'preact/hooks';
import { SessionStateContext } from '@/client/hooks/workspace/session-state/context';
import { clearSessionKey, getSessionValue } from '@/shared/lib/workspace/session-state/store';
import { writeSetting } from '@/shared/lib/settings/client';
import {
  LEGACY_SESSION_COLLAPSED_KEY,
  MODEL_PICKER_COLLAPSED_SETTING_KEY,
  readCollapsedSections,
} from '@/shared/lib/models/picker-collapsed';

export function useCollapsedSections(): [Record<string, boolean>, (section: string) => void] {
  const context = useContext(SessionStateContext);
  const sessionId = context?.sessionId ?? null;
  const ready = context?.ready ?? false;

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsedSections);

  // Adopt the fold an older build stored under THIS session, once — then retire
  // the slot, so the blob stops carrying a second answer for the question. The
  // global value wins whenever it exists: it was written after the move, by a
  // reader who has already folded what they want folded.
  useEffect(() => {
    if (!ready || !sessionId) return;
    const legacy = getSessionValue<Record<string, boolean>>(sessionId, LEGACY_SESSION_COLLAPSED_KEY);
    if (!legacy) return;
    if (Object.keys(readCollapsedSections()).length === 0 && Object.keys(legacy).length > 0) {
      writeSetting(MODEL_PICKER_COLLAPSED_SETTING_KEY, legacy);
      setCollapsed(legacy);
    }
    clearSessionKey(sessionId, LEGACY_SESSION_COLLAPSED_KEY);
  }, [sessionId, ready]);

  const toggleSection = useCallback((section: string) => {
    setCollapsed(prev => {
      const next = { ...prev, [section]: !prev[section] };
      writeSetting(MODEL_PICKER_COLLAPSED_SETTING_KEY, next);
      return next;
    });
  }, []);

  return [collapsed, toggleSection];
}
