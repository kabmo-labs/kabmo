/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { createContext, useContext } from 'preact/compat';
import type { TtsConfig } from '@/shared/lib/tts/settings';
import type { TtsStatus } from '@/client/lib/tts/player';

/**
 * What the assistant footer needs from the speech player.
 *
 * `enabled` is false outside the chat timeline (the settings preview, the BTW
 * panel before its provider mounts): the footer then draws no speaker button
 * rather than a control that would do nothing.
 */
export interface TtsHandle {
  enabled: boolean;
  status: TtsStatus;
  activeKey: string | null;
  error: string | null;
  speak: (text: string, key: string, config?: TtsConfig) => void;
  stop: () => void;
}

const DISABLED: TtsHandle = {
  enabled: false,
  status: 'idle',
  activeKey: null,
  error: null,
  speak: () => undefined,
  stop: () => undefined,
};

export const TtsContext = createContext<TtsHandle>(DISABLED);

export function useTts(): TtsHandle {
  return useContext(TtsContext);
}
