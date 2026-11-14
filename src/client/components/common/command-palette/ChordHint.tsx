/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pending-chord hint.
 *
 * A two-stroke chord consumes its first stroke, so without a visible hint the
 * user sees a key do nothing. VS Code shows the prefix in the status bar; this
 * is the same fact in the corner of the window.
 */

import { useEffect, useState } from 'preact/hooks';
import { formatChord } from '@/shared/lib/commands/chord';
import type { Chord } from '@/shared/lib/commands/types';
import { isMacPlatform } from '@/shared/lib/util/platform';
import { subscribePendingChord } from '@/client/lib/commands/dispatcher';

export function ChordHint() {
  const [pending, setPending] = useState<Chord | null>(null);

  useEffect(() => subscribePendingChord(setPending), []);

  if (!pending) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[80] px-2.5 py-1 rounded-md border border-ink/20 bg-paper text-[11px] font-mono text-ink/70 shadow-lg"
    >
      {formatChord(pending, isMacPlatform())} …
    </div>
  );
}
