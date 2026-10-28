/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Access-control (approval) mode for the composer: a global, persisted user
 * preference, unlike the per-session model/thinking picks. It hydrates from
 * appSettings at first paint and is mirrored into a ref so the send path reads
 * the latest value without re-creating `executeSend`. Extracted from
 * useChatTimeline so that hook stays under the repo's per-file size ceiling.
 */

import { useCallback, useRef, useState } from 'preact/hooks';
import { ACCESS_MODE_SETTING_KEY, normalizeApprovalMode } from '@/shared/lib/omp/config/access-mode';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { writeSetting } from '@/shared/lib/settings/client';

export interface ChatTimelineAccessMode {
  accessMode: ApprovalMode;
  /** Live value for callbacks created once (send, queue delivery). */
  accessModeRef: { current: ApprovalMode };
  setAccessMode: (mode: ApprovalMode) => void;
}

export function useChatTimelineAccessMode(appSettings: Record<string, any>): ChatTimelineAccessMode {
  const [accessMode, setAccessModeState] = useState<ApprovalMode>(() => normalizeApprovalMode(appSettings.omp_access_mode));
  const accessModeRef = useRef<ApprovalMode>(accessMode);
  accessModeRef.current = accessMode;

  const setAccessMode = useCallback((mode: ApprovalMode) => {
    setAccessModeState(mode);
    accessModeRef.current = mode;
    // Persist the last selection; the server reads this key as the spawn-time
    // default. Fire-and-forget: the in-memory value is already authoritative
    // for this session's requests, which carry it explicitly.
    writeSetting(ACCESS_MODE_SETTING_KEY, mode);
  }, []);

  return { accessMode, accessModeRef, setAccessMode };
}
