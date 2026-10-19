import { useCallback } from 'preact/hooks';
import { writeKabmoSettings } from '@/shared/lib/settings/client';

/**
 * Stable writer for the Kabmo settings blob: applies the patch to the
 * in-memory snapshot, then persists the merged blob to SQLite.
 */
export function useKabmoSettingsWriter(): (patch: Record<string, any>) => void {
  return useCallback((patch: Record<string, any>) => {
    writeKabmoSettings(patch);
  }, []);
}

/** @deprecated Use `useKabmoSettingsWriter`. */
export const useChamberSettingsWriter = useKabmoSettingsWriter;
