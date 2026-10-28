/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Pure helpers over `Target.getTargets` / `Target.targetInfoChanged` payloads.
 * Only `type === 'page'` entries are real browser tabs; devtools, service
 * workers, and browser-internal targets are ignored.
 */

import { readString } from '@/shared/lib/browser/util';
import { isRecord } from '@/shared/lib/util/guards';

export interface PageTarget {
  targetId: string;
  url: string;
  title: string;
}

/** Parse the `Target.getTargets` result into page targets (in CDP order). */
export function parsePageTargets(result: unknown): PageTarget[] {
  const infos = isRecord(result) && Array.isArray(result.targetInfos) ? result.targetInfos : [];
  const pages: PageTarget[] = [];
  for (const info of infos) {
    if (!isRecord(info) || info.type !== 'page') continue;
    const targetId = readString(info, 'targetId');
    if (!targetId) continue;
    pages.push({ targetId, url: readString(info, 'url') ?? '', title: readString(info, 'title') ?? '' });
  }
  return pages;
}

/**
 * Choose the tab to view: an explicit preference while it is still a live page
 * this session owns (Kabmo-user click), else the newest owned page from the
 * session's creation-ordered registry. Never picks another session's tab — the
 * shared daemon hosts every session's pages, so both the unscoped fallback and
 * an unowned pin would leak one session's browsing into another session's
 * panel.
 */
export function pickTargetId(pages: PageTarget[], ownedIds: string[], preferTargetId?: string): string | null {
  if (pages.length === 0 || ownedIds.length === 0) return null;
  const live = new Set(pages.map((page) => page.targetId));
  const owned = new Set(ownedIds);
  if (preferTargetId && owned.has(preferTargetId) && live.has(preferTargetId)) return preferTargetId;
  for (let index = ownedIds.length - 1; index >= 0; index -= 1) {
    const candidate = ownedIds[index];
    if (candidate && live.has(candidate)) return candidate;
  }
  return null;
}

/** Filter live pages down to the session's owned targets, registry order. */
export function ownedPages(pages: PageTarget[], ownedIds: string[]): PageTarget[] {
  if (ownedIds.length === 0) return [];
  const live = new Map(pages.map((page) => [page.targetId, page]));
  const owned: PageTarget[] = [];
  for (const id of ownedIds) {
    const page = live.get(id);
    if (page) owned.push(page);
  }
  return owned;
}

/** Extract a page-target patch from a `Target.targetInfoChanged` event. */
export function readTargetInfoPatch(params: unknown): PageTarget | null {
  if (!isRecord(params) || !isRecord(params.targetInfo)) return null;
  const info = params.targetInfo;
  if (info.type !== 'page') return null;
  const targetId = readString(info, 'targetId');
  if (!targetId) return null;
  return { targetId, url: readString(info, 'url') ?? '', title: readString(info, 'title') ?? '' };
}
