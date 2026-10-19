/**
 * Persistence for the sidebar's expanded-session rows.
 *
 * This is cross-session UI state (which session rows show their live subagent
 * roster), stored in `app_settings` under its own key. The save path caps the
 * array so it cannot grow without bound.
 */

import { readKabmoSetting, writeSetting } from '@/shared/lib/settings/client';

const SETTINGS_KEY = 'omp_sidebar_expanded_sessions';
/** Beyond this many ids the oldest are dropped on save. */
const MAX_IDS = 50;

export function loadExpandedSessionIds(): Set<string> {
  const parsed = readKabmoSetting<unknown>(SETTINGS_KEY);
  if (!Array.isArray(parsed)) return new Set();
  return new Set(parsed.filter((id): id is string => typeof id === 'string'));
}

export function saveExpandedSessionIds(ids: Set<string>): void {
  writeSetting(SETTINGS_KEY, [...ids].slice(-MAX_IDS));
}
