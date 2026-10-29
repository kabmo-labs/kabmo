/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which model-picker sections (a provider, FAVORITES, RECENT) the reader has
 * folded, as a GLOBAL preference.
 *
 * It is not per-session state. A reader folds the providers they never use, and
 * that answer does not change when they start a new chat. The map lived in the
 * session UI blob for one release (`chat.modelDropdownCollapsed`), so every
 * chat that had never stored one — every new chat, every session opened for the
 * first time — drew the list fully expanded and the fold read as never applied.
 * The sidebar's width is stored the same way and for the same reason.
 *
 * `app_settings` is the single source of truth (there is no localStorage), and
 * the write is a top-level key: the server merges an object patch key by key,
 * so one section's flip never rewrites the others.
 */
import { readKabmoSetting } from '@/shared/lib/settings/client';

/** `app_settings` key holding the `section → folded` map. */
export const MODEL_PICKER_COLLAPSED_SETTING_KEY = 'omp_model_dropdown_collapsed';

/**
 * The per-session slot the map lived in before it was global. Read once per
 * session — to carry an install's existing fold over — and then cleared, so a
 * blob stops holding a second answer for this question.
 */
export const LEGACY_SESSION_COLLAPSED_KEY = 'chat.modelDropdownCollapsed';

/** A stored value is trusted only as a `section → boolean` map. */
function collapsedMap(value: unknown): Record<string, boolean> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const map: Record<string, boolean> = {};
  for (const [section, folded] of Object.entries(value)) {
    if (typeof folded === 'boolean') map[section] = folded;
  }
  return map;
}

/** The stored folds, normalized — anything else is dropped, not trusted. */
export function readCollapsedSections(): Record<string, boolean> {
  return collapsedMap(readKabmoSetting<unknown>(MODEL_PICKER_COLLAPSED_SETTING_KEY));
}
