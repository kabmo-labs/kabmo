/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Lazy boundary for the settings modal.
 *
 * The settings tree is 68 modules plus the ~160 kB `omp-schema.json`, and it is
 * reached only by a click — yet `Modal.tsx` was imported statically by the
 * desktop layout, the mobile layout, and the sidebar, so every page load paid
 * for all of it. Importing through here moves the subtree to its own async
 * chunk and takes ~84 kB gzip off the initial payload.
 *
 * The `isOpen` gate is load-bearing, not cosmetic: `lazy()` starts fetching as
 * soon as the component renders, even when the wrapped component would render
 * `null` internally. Without the gate the chunk would be requested at boot and
 * nothing would be saved.
 *
 * All three call sites already own the open state (each layout runs its own
 * `omp:open-settings` listener), so gating preserves the existing contract. The
 * unmount is safe for settings values too: `mergeKabmoSettings` re-reads the
 * in-memory snapshot in `lib/settings/client`, which every write updates, not
 * the stale bootstrap payload.
 *
 * `fallback={null}` matches the other lazy dialog boundary
 * (`tool-renderers/extension-dialog/Lazy.tsx`): the modal is a full-screen overlay
 * that appears on user intent, so a brief absence reads as the click landing
 * rather than as a broken surface.
 */

import { Suspense, lazy } from 'preact/compat';
import type { SettingsModalProps } from '@/client/components/settings/Modal';

const SettingsModalImpl = lazy(() =>
  import('@/client/components/settings/Modal').then((m) => ({ default: m.SettingsModal }))
);

export function SettingsModal({ isOpen, ...rest }: SettingsModalProps) {
  if (!isOpen) return null;
  return (
    <Suspense fallback={null}>
      <SettingsModalImpl isOpen={isOpen} {...rest} />
    </Suspense>
  );
}
