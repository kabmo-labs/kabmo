/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the two halves of this plugin say to each other.
 *
 * A forge is two vendors with one vocabulary, so the shapes here are OURS: the
 * panel never sees a GitHub issue object or a GitLab merge-request object, and
 * the adapters are the only place either spelling exists. That is what lets the
 * sidebar say "Merge requests" on GitLab and "Pull requests" on GitHub from one
 * component, and it is why a section is named for the JOB rather than for the
 * vendor's word for it.
 *
 * Three properties are load-bearing:
 *
 * - **One read answers ALL THREE sections.** The sidebar is the selector, and a
 *   selector with no counts is a guess; asking three times per switch would make
 *   browsing cost three round trips per click. So `list` fetches all three and
 *   the panel switches locally.
 * - **A section that fails does not take the others with it.** A releases
 *   endpoint that answers 404 (a GitLab project with no releases) must not blank
 *   the issue list, so a partial read carries `notes` rather than failing.
 * - **Nothing here names a token.** The credential lives on the server; the
 *   panel only ever learns which SOURCE it came from.
 */

/** The two APIs this plugin speaks. */
export type ForgeProvider = 'github' | 'gitlab';

/** What the panel's sidebar lists. `pulls` is PRs on GitHub, MRs on GitLab. */
export type ForgeSection = 'issues' | 'pulls' | 'releases';

/** The state filter a read carries. Releases ignore it. */
export type ForgeState = 'open' | 'closed' | 'all';

/**
 * A row's display state.
 *
 * `draft` is a PR/MR that is still open, and `prerelease` is a release that is
 * published but flagged — both are shown as their own badge because collapsing
 * them into `open`/`published` hides the one fact a reviewer checks first.
 */
export type ForgeItemState = 'open' | 'closed' | 'merged' | 'draft' | 'published' | 'prerelease';

export interface ForgeLabel {
  name: string;
  /** Six hex digits without `#`, as GitHub reports it. Null when the host has none. */
  color: string | null;
}

/** One issue, pull request, merge request or release. */
export interface ForgeItem {
  /** Stable within its section: the number as a string, or a release tag. */
  id: string;
  /** The issue/PR number, or null for a release. */
  number: number | null;
  title: string;
  state: ForgeItemState;
  author: string;
  /** ISO timestamp the host reports as last activity. */
  updatedAt: string;
  /** The page on the host. */
  url: string;
  labels: ForgeLabel[];
  comments: number;
  /** A release's tag; null for the other sections. */
  tag: string | null;
}

export interface ForgeSectionData {
  items: ForgeItem[];
  /** The host returned a full page, so there may be more than this. */
  truncated: boolean;
}

/** One read of all three sections. */
export interface ForgeList {
  provider: ForgeProvider;
  host: string;
  /** `owner/name`, subgroups included. */
  slug: string;
  webUrl: string;
  state: ForgeState;
  sections: Record<ForgeSection, ForgeSectionData>;
  /** Non-fatal sentences: a section that failed, an anonymous read. */
  notes: string[];
}

export interface ForgeComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url: string | null;
}

/** One labelled fact about an item, e.g. `base ← head` or `+12 −3`. */
export interface ForgeFact {
  label: string;
  value: string;
}

export interface ForgeDetail {
  item: ForgeItem;
  /** Markdown, exactly as the host stores it. */
  body: string;
  comments: ForgeComment[];
  facts: ForgeFact[];
  notes: string[];
}

export interface ForgeListInput {
  root: string;
  repo: string;
  state: ForgeState;
}

export interface ForgeDetailInput {
  root: string;
  repo: string;
  section: ForgeSection;
  id: string;
}

/** The method names, in one place so a typo is a compile error on both sides. */
export const RPC = {
  list: 'list',
  detail: 'detail',
} as const;

export const SECTIONS: readonly ForgeSection[] = ['issues', 'pulls', 'releases'];

export function isSection(value: unknown): value is ForgeSection {
  return value === 'issues' || value === 'pulls' || value === 'releases';
}

export function isState(value: unknown): value is ForgeState {
  return value === 'open' || value === 'closed' || value === 'all';
}

/** An empty section, for a read that has not answered yet or failed. */
export function emptySection(): ForgeSectionData {
  return { items: [], truncated: false };
}
