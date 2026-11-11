/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Presentation of one item's state, time and count.
 *
 * The tone vocabulary is Kabmo's own status table, and it uses the `-text`
 * slots rather than the raw signal fills: `--theme-success` is chosen for a
 * chip's ground and measures 1.75:1 as text on `nord-light`, while
 * `--theme-success-text` is the same hue solved to 4.5:1. A state word is read,
 * so it takes the readable slot.
 *
 * `merged` has no `-text` utility in every host build, so it is the one class
 * the plugin's own stylesheet owns (`panel.css`), reading the same variable.
 *
 * `sectionLabel` is the one place a vendor word is translated for the reader,
 * and it is deliberately generic: `merged` on GitLab and `merged` on GitHub are
 * the same word, but a GitLab *merge request* is what the sidebar calls the
 * section.
 */

import type { ForgeItemState, ForgeProvider, ForgeSection, ForgeSectionData } from '../protocol';

export const STATE_TONE: Record<ForgeItemState, string> = {
  open: 'text-success-text',
  closed: 'text-ink/65',
  merged: 'forge-merged',
  draft: 'text-ink/65',
  published: 'text-success-text',
  prerelease: 'text-warning-text',
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

/** The host's display name, for the header chip. */
export function providerLabel(provider: ForgeProvider): string {
  if (provider === 'github') return 'GitHub';
  if (provider === 'gitlab') return 'GitLab';
  if (provider === 'gitea') return 'Gitea';
  return 'Bitbucket';
}

/**
 * A section's count, as the sidebar draws it.
 *
 * Three answers, and they are not interchangeable: a number is a count, a `+`
 * says the host returned a full page, and `!` says the read FAILED. A failed
 * read drawn as `0` is a confident wrong number, and it is the number a reader
 * acts on.
 */
export function countLabel(data: ForgeSectionData | undefined): string {
  if (!data) return '';
  if (data.failed) return '!';
  return data.truncated ? `${data.items.length}+` : String(data.items.length);
}

/** The tooltip a count carries, so `!` and `+` are explained where they are read. */
export function countTitle(data: ForgeSectionData | undefined): string {
  if (!data) return '';
  if (data.failed) return 'This section could not be read';
  if (data.truncated) return `Showing the first ${data.items.length}; the host returned a full page`;
  return `${data.items.length} ${data.items.length === 1 ? 'item' : 'items'}`;
}

/**
 * A compact age: `now`, `5m`, `3h`, `2d`, `4w`.
 *
 * Compact rather than "3 days ago" because a row is one line at 11px in a 320px
 * panel, and the date is context rather than the thing being read. The full
 * timestamp is the tooltip, so the compact form never hides the fact.
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

/** The full timestamp behind a compact age, for a tooltip. */
export function fullTime(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  return new Date(at).toLocaleString();
}

/** `#12` for an issue or request; the tag for a release. */
export function itemIdLabel(item: { number: number | null; tag: string | null }): string {
  return item.number !== null ? `#${item.number}` : (item.tag ?? '');
}
