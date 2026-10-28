/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Presentation of one item's state and time.
 *
 * The tone vocabulary is Kabmo's own status table (`todo/progress.ts` uses the
 * same three tokens): `success` for a live/open state, `warning` for something
 * that wants attention, `ink/45` for settled. A forge's states map onto that
 * directly, which is why no colour is invented here.
 *
 * `stateLabel` is the one place a vendor word is translated for the reader, and
 * it is deliberately generic: `merged` on GitLab and `merged` on GitHub are the
 * same word, but a GitLab *merge request* is what the sidebar calls the section.
 */

import type { ForgeItemState, ForgeProvider, ForgeSection } from '../protocol';

export const STATE_TONE: Record<ForgeItemState, string> = {
  open: 'text-success',
  closed: 'text-ink/45',
  merged: 'text-info',
  draft: 'text-ink/55',
  published: 'text-success',
  prerelease: 'text-warning',
};

export const STATE_LABEL: Record<ForgeItemState, string> = {
  open: 'Open',
  closed: 'Closed',
  merged: 'Merged',
  draft: 'Draft',
  published: 'Published',
  prerelease: 'Pre-release',
};

/** What a section is called, which is the one vendor difference a reader sees. */
export function sectionLabel(section: ForgeSection, provider: ForgeProvider): string {
  if (section === 'issues') return 'Issues';
  if (section === 'releases') return 'Releases';
  return provider === 'gitlab' ? 'Merge requests' : 'Pull requests';
}

/** The short form the phone's chip and the sidebar count use. */
export function sectionShort(section: ForgeSection, provider: ForgeProvider): string {
  if (section === 'issues') return 'Issues';
  if (section === 'releases') return 'Releases';
  return provider === 'gitlab' ? 'MRs' : 'PRs';
}

/**
 * A compact age: `now`, `5m`, `3h`, `2d`, `4w`.
 *
 * Compact rather than "3 days ago" because a row is one line at 11px in a 320px
 * panel, and the date is context rather than the thing being read.
 */
export function relativeTime(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return `${Math.round(days / 30)}mo`;
}

/** `#12` for an issue or request; the tag for a release. */
export function itemIdLabel(item: { number: number | null; tag: string | null }): string {
  return item.number !== null ? `#${item.number}` : (item.tag ?? '');
}
