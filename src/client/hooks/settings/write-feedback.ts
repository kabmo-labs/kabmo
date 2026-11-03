/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Write feedback for a settings pane: whether the last save/delete is still in
 * flight, whether it landed, and the server's own sentence when it did not.
 *
 * The panes used to show "Saved successfully" the instant the button was
 * pressed, before the request had answered — so a refused write (a duplicate
 * agent name, a read-only native file, a validator rejecting the draft) showed
 * a success badge over a row that had not changed. The outcome of the write is
 * now the only thing that sets the badge.
 */

import { useCallback, useRef, useState } from 'preact/hooks';
import type { WriteOutcome } from '@/shared/types';

export interface WriteFeedback {
  saving: boolean;
  saved: boolean;
  /** The last refusal's sentence; stays until the next write or dismissal. */
  error: string | null;
  dismissError: () => void;
  /** Run one write and report its real outcome. Resolves `true` when it landed. */
  run: (action: () => Promise<WriteOutcome>) => Promise<boolean>;
}

const SAVED_FLASH_MS = 2000;

export function useWriteFeedback(): WriteFeedback {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flash = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const dismissError = useCallback(() => setError(null), []);

  const run = useCallback(async (action: () => Promise<WriteOutcome>): Promise<boolean> => {
    setSaving(true);
    setError(null);
    clearTimeout(flash.current);
    setSaved(false);
    try {
      const outcome = await action();
      if (!outcome.ok) {
        setError(outcome.error ?? 'The server refused the write.');
        return false;
      }
      setSaved(true);
      flash.current = setTimeout(() => setSaved(false), SAVED_FLASH_MS);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { saving, saved, error, dismissError, run };
}
