/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The workspace panel stack's lazy boundary.
 *
 * The views are `lazy()`, and Preact THROWS the pending promise out of the tree
 * when a lazy child suspends with no `<Suspense>` above it — a blank page rather
 * than a loading state. It lives in its own module because the layout file is at
 * the 350-line ceiling and this is a self-contained shell.
 */

import { Suspense } from 'preact/compat';
import type { ReactNode } from 'preact/compat';

export function PanelSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="w-full h-full flex items-center justify-center text-ink/40">
          <span className="text-xs font-mono">Loading…</span>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
