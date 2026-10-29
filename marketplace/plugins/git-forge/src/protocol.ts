/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What the two halves of this plugin say to each other.
 *
 * A forge is several vendors with one vocabulary, so the shapes here are OURS:
 * the panel never sees a GitHub issue object or a GitLab merge-request object,
 * and the adapters are the only place either spelling exists. That is what lets
 * the sidebar say "Merge requests" on GitLab and "Pull requests" on GitHub from
 * one component, and it is why a section is named for the JOB rather than for
 * the vendor's word for it.
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
 * - **Nothing here names a token.** The credential lives on the server; the panel
 *   only ever learns which SOURCE it came from.
 */

/** The APIs this plugin speaks. */
export type ForgeProvider = 'github' | 'gitlab' | 'gitea' | 'bitbucket';

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

/**
 * The filter a read carries beyond the state.
 *
 * `mine` is a boolean rather than a username because every host has its own way
 * of saying "the authenticated user" and only one of them accepts a literal:
 * GitHub's search takes `assignee:@me`, GitLab takes `scope=assigned_to_me`.
 * Sending an id would mean resolving the viewer first, on every read.
 */
export interface ForgeFilter {
  state: ForgeState;
  /** Only items assigned to the authenticated user. */
  mine: boolean;
  /** One label, matched exactly. Empty means none. */
  label: string;
  /** Free text, matched by the host's own search. */
  query: string;
}

export interface ForgeLabel {
  name: string;
  /** Six hex digits without `#`, as GitHub reports it. Null when the host has none. */
  color: string | null;
}

/**
 * A pipeline's verdict, normalized across hosts.
 *
 * Detail-only, deliberately. No host puts a pipeline on a LIST response:
 * measured on GitLab, `head_pipeline` is `failed` on the single merge request
 * and `null` on every row of the collection, and GitHub's PR list carries no
 * checks at all. A row badge would therefore cost one request per row — twenty
 * extra reads for a page nobody has opened — so the badge lives where it is
 * already free: the item's own page.
 */
export type ForgeCiState = 'success' | 'failure' | 'pending' | 'neutral';

/** The CI verdict for an item, when the host reports one. */
export interface ForgeCi {
  state: ForgeCiState;
  /** What the host called it (`success`, `FAILURE`, `passed`), for the tooltip. */
  label: string;
  url: string | null;
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
  /** How many the host says exist, when it says. */
  total: number | null;
  /**
   * The read FAILED, so an empty list here means "could not be read".
   *
   * A section that answers 403 is not a section with nothing in it, and drawing
   * the two the same way makes a wrong token look like an empty project — the
   * count in the header said `0 issues` for a refused read before this flag.
   */
  failed: boolean;
}

/** One read of all three sections. */
export interface ForgeList {
  provider: ForgeProvider;
  host: string;
  /** `owner/name`, subgroups included. */
  slug: string;
  webUrl: string;
  filter: ForgeFilter;
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
  /** The host's own audit note ("changed the description"), not a reply. */
  system: boolean;
  /** The author is a bot or an app. */
  bot: boolean;
}

/** One file a change touches. */
export interface ForgeFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  /** The unified hunk text, when the host sends it. */
  patch: string;
}

/** One commit in a change. */
export interface ForgeCommit {
  sha: string;
  message: string;
  author: string;
  at: string;
}

/** One labelled fact about an item, e.g. `base ← head` or `+12 −3`. */
export interface ForgeFact {
  label: string;
  value: string;
}

/**
 * What the credential and the host together allow.
 *
 * Derived per detail read rather than stored: a read-only token and a public
 * repository are the same thing from the panel's side, and a button that can
 * only fail is worse than no button.
 */
export interface ForgeCapabilities {
  comment: boolean;
  state: boolean;
  review: boolean;
  merge: boolean;
  /**
   * The merge styles the host can actually perform for this change.
   *
   * A separate list rather than a boolean because the styles are not
   * interchangeable: GitLab and Bitbucket have no rebase-only merge, and
   * offering one there would send a request that silently performs an ordinary
   * merge while the confirmation promised no merge commit.
   */
  mergeMethods: ForgeMergeMethod[];
  /**
   * The review verdicts the host can express.
   *
   * GitLab has `approve` and nothing else: "request changes" is not an event
   * there, so a button for it could only fail.
   */
  reviewVerdicts: ForgeReviewVerdict[];
}

/** The merge styles a change can be merged with. */
export type ForgeMergeMethod = 'merge' | 'squash' | 'rebase';

/** The verdicts a review can carry. */
export type ForgeReviewVerdict = 'approve' | 'request_changes';

export interface ForgeDetail {
  item: ForgeItem;
  /** Markdown, exactly as the host stores it. */
  body: string;
  comments: ForgeComment[];
  facts: ForgeFact[];
  files: ForgeFile[];
  commits: ForgeCommit[];
  ci: ForgeCi | null;
  capabilities: ForgeCapabilities;
  notes: string[];
}

export interface ForgeListInput {
  root: string;
  repo: string;
  filter: ForgeFilter;
}

export interface ForgeDetailInput {
  root: string;
  repo: string;
  section: ForgeSection;
  id: string;
}

/** One write the panel may ask for. */
export type ForgeWrite =
  | { kind: 'comment'; body: string }
  | { kind: 'state'; state: 'open' | 'closed' }
  | { kind: 'review'; verdict: ForgeReviewVerdict; body: string }
  | { kind: 'merge'; method: ForgeMergeMethod };

export interface ForgeWriteInput extends ForgeDetailInput {
  write: ForgeWrite;
}

/** What a write answers: the item as it now stands, and any note worth reading. */
export interface ForgeWriteResult {
  item: ForgeItem;
  message: string;
}

/** The credential as the panel may see it: which source, and whether it can write. */
export interface ForgeCredential {
  source: 'setting' | 'environment' | 'cli' | 'none';
  /** A credential is present at all. */
  present: boolean;
  /** The host accepted it for a write-capable scope, when it was checked. */
  writeScope: boolean | null;
}

/**
 * How much is waiting on the reader, for the navbar readout.
 *
 * Two numbers and no list: a readout is one line in a header, and a payload it
 * has to narrow is a payload the server could have narrowed. `null` means the
 * count could not be read, which is different from zero and is drawn as `—`.
 *
 * `more` exists because a host that reports no total (GitLab) answers a PAGE,
 * and drawing that page's length as the total is a confident wrong number — the
 * readout says `30+` instead of `30`.
 */
export interface ForgeCounts {
  /** Open issues assigned to the authenticated user. */
  issues: number | null;
  /** Open pull / merge requests assigned to the authenticated user. */
  pulls: number | null;
  /** That count is a page's length, so there are at least this many. */
  more: { issues: boolean; pulls: boolean };
  /** The host, for the readout's tooltip. */
  host: string;
  /** Why a count is null, when it is. */
  note: string | null;
}

/** The method names, in one place so a typo is a compile error on both sides. */
export const RPC = {
  list: 'list',
  detail: 'detail',
  write: 'write',
  credential: 'credential',
  counts: 'counts',
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
  return { items: [], truncated: false, total: null, failed: false };
}

/**
 * No filter: open, everything, no label, no text.
 *
 * ONE frozen object rather than a factory, and that is load-bearing. The panel
 * passes this to `useSessionState` as its FALLBACK, and that hook's setters are
 * `useCallback`s over `[sessionId, key, fallback]` — so a fresh object per render
 * gives the setter a new identity per render, which re-arms the effect that
 * writes it, which renders again. Measured: the panel mounted and never painted,
 * with the test run hitting its timeout instead of failing an assertion.
 *
 * Every writer replaces the object immutably (`{ ...filter, state }`), so sharing
 * one instance cannot leak a mutation between readers.
 */
export const DEFAULT_FILTER: ForgeFilter = Object.freeze({
  state: 'open',
  mine: false,
  label: '',
  query: '',
});

/** A fresh copy, for a caller that needs one (a test fixture, a merge base). */
export function defaultFilter(): ForgeFilter {
  return { ...DEFAULT_FILTER };
}

/** Whether a filter is anything but the default, for a "clear" control. */
export function filterIsDefault(filter: ForgeFilter): boolean {
  return filter.state === 'open' && !filter.mine && !filter.label.trim() && !filter.query.trim();
}

/** The capabilities a read-only view has: none of them. */
export function readOnly(): ForgeCapabilities {
  return { comment: false, state: false, review: false, merge: false, mergeMethods: [], reviewVerdicts: [] };
}
