/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'preact/hooks';
import {
  keyBindingHelpOpen,
  paletteState,
  subscribeOverlays,
  type PaletteState,
} from '@/client/lib/commands/overlays';

export interface OverlaySnapshot {
  palette: PaletteState;
  help: boolean;
}

/** The palette and the shortcut sheet, as the app root draws them. */
export function useOverlays(): OverlaySnapshot {
  const [snapshot, setSnapshot] = useState<OverlaySnapshot>(() => ({
    palette: paletteState(),
    help: keyBindingHelpOpen(),
  }));

  useEffect(
    () =>
      subscribeOverlays(() =>
        setSnapshot({ palette: paletteState(), help: keyBindingHelpOpen() }),
      ),
    [],
  );

  return snapshot;
}
