/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Access-control (approval) mode for the composer.
 *
 * omp's transports use this as omp's own approval gate (a spawn flag over RPC,
 * omp's `tools.approvalMode` over ACP). Every other harness only gets Kabmo's
 * tier as the answer policy for `session/request_permission`, so the pick is
 * kept PER HARNESS: switching the composer's harness tab must never carry a
 * `yolo` chosen for omp onto an agent that never granted it. omp's own pick is
 * mirrored into the global `omp_access_mode` key, which the server reads as its
 * spawn-time default for the paths that carry no explicit selection.
 *
 * The value is mirrored into a ref so the send path reads the latest one
 * without re-creating `executeSend`. Extracted from useChatTimeline so that
 * hook stays under the repo's per-file size ceiling.
 */

import { useCallback, useRef, useState } from 'preact/hooks';
import {
  ACCESS_MODE_SETTING_KEY,
  HARNESS_ACCESS_MODES_SETTING_KEY,
  accessModeForHarness,
  isOmpHarness,
  readAccessModePicks,
} from '@/shared/lib/omp/config/access-mode';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { writeSetting } from '@/shared/lib/settings/client';

export interface ChatTimelineAccessMode {
  accessMode: ApprovalMode;
  /** Live value for callbacks created once (send, queue delivery). */
  accessModeRef: { current: ApprovalMode };
  setAccessMode: (mode: ApprovalMode) => void;
}

export function useChatTimelineAccessMode(
  appSettings: Record<string, any>,
  harness?: string | null,
): ChatTimelineAccessMode {
  const [picks, setPicks] = useState<Record<string, ApprovalMode>>({});
  const picksRef = useRef(picks);
  picksRef.current = picks;
  const settingsRef = useRef(appSettings);
  settingsRef.current = appSettings;
  // The stored map is read on every render rather than captured at mount: the
  // timeline can mount before `/api/settings` lands, and a captured copy left
  // the composer on `always-ask` after the operator's own pick was on disk.
  const stored = readAccessModePicks(appSettings);
  // Derived, never stored: the harness can change under a pending chat (the
  // tab strip), and this hook is the one place that turns that into a tier.
  const accessMode = accessModeForHarness(harness, { ...stored, ...picks }, appSettings);
  const accessModeRef = useRef<ApprovalMode>(accessMode);
  accessModeRef.current = accessMode;

  const setAccessMode = useCallback((mode: ApprovalMode) => {
    const key = harness ?? 'omp-rpc';
    const next = { ...readAccessModePicks(settingsRef.current), ...picksRef.current, [key]: mode };
    picksRef.current = next;
    setPicks(next);
    writeSetting(HARNESS_ACCESS_MODES_SETTING_KEY, next);
    // The global key stays omp's spawn-time default (a scheduled task, a child
    // spawn, a held prompt). Another harness reads its own entry, never this.
    if (isOmpHarness(harness)) writeSetting(ACCESS_MODE_SETTING_KEY, mode);
  }, [harness]);

  return { accessMode, accessModeRef, setAccessMode };
}
