/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Repository-wiki contracts for the right-panel Wiki view.
 *
 * A wiki is not an API: GitHub and GitLab both publish it as a SEPARATE git
 * repository beside the project (`<remote>.wiki.git`), so Kabmo reads it
 * the way a reader would — the wiki's own git history — and never needs a
 * provider token, an API version, or a per-host code path. That one fact is why
 * a single implementation covers github.com, gitlab.com and a self-hosted
 * GitLab (`git-rbi.jatismobile.com`): the URL shape is the same on all three.
 *
 * The provider name below is therefore a LABEL for the reader (it picks the web
 * URL of a page and the badge in the header), never a branch in the fetch.
 */

/** Which host the wiki lives on, as far as the reader is concerned. */
export type WikiProvider = 'github' | 'gitlab' | 'other';

/** The wiki behind one scoped repository, or the reason there is none. */
export interface WikiRepoInfo {
  provider: WikiProvider;
  /** Host of the git remote (`github.com`, `git-rbi.jatismobile.com`). */
  host: string;
  /** `owner/name` (GitLab: subgroups included) as the remote spells it. */
  slug: string;
  /**
   * Credential-free URL of the PROJECT repository. The fetch may carry a token
   * in its own URL — that is how a self-hosted GitLab authenticates — and
   * echoing it back to the page would put a secret in the DOM, the devtools
   * network tab and any screenshot of the panel.
   */
  remote: string;
  /** Web page of the wiki, for "open in browser". Null when it cannot be derived. */
  webUrl: string | null;
  /** Commit the page list was read at. */
  revision: string;
  /** ISO timestamp of that commit. */
  updatedAt: string;
}

/**
 * One path in the wiki tree.
 *
 * Assets are entries too — a page's `![](images/schema.png)` has to resolve
 * against the same tree the pages do — so the reader filters on `isMarkdown`
 * for the list and uses the whole set for reference resolution.
 */
export interface WikiEntry {
  /** Path inside the wiki repository, extension included (`Home.md`). */
  path: string;
  /** Title as the panel lists it (basename, extension stripped). */
  title: string;
  /** Directory segments, for the grouped list (`change_logs`). */
  folder: string;
  /** Rendered as markdown by the panel; false for an asset in the tree. */
  isMarkdown: boolean;
}

/** One entry of a wiki's own `_Sidebar.md`. */
export interface WikiNavLink {
  /** Label as the author wrote it (`🏠 Home`, `v1.6.0`). */
  label: string;
  /** Target exactly as written, for a tooltip and for the inert case. */
  target: string;
  /** Wiki path when the target resolved into this wiki's tree; else null. */
  path: string | null;
  /** Absolute URL when the target is an external link; else null. */
  url: string | null;
}

/**
 * One group of a wiki's own `_Sidebar.md`.
 *
 * The sidebar is the author's navigation — its grouping, order and labels — so
 * the panel renders it rather than re-deriving a tree from the file layout.
 * GitHub's gollum and GitLab both serve this file as the navigation around every
 * page, and a wiki that has one should look like the wiki its author built.
 */
export interface WikiNavSection {
  /** Heading the author wrote; null for links written before any heading. */
  title: string | null;
  links: WikiNavLink[];
  /** Section text that is not a link — a real sidebar's `**Version**: 1.6.0`. */
  notes: string[];
}

/** Wire payload of `GET /api/wiki`. */
export interface WikiRepoPayload {
  repo: WikiRepoInfo | null;
  /** Every path in the wiki tree; the list shows the markdown ones. */
  entries: WikiEntry[];
  /**
   * The wiki's own navigation, parsed from `_Sidebar.md`, or null when it has
   * none — a wiki without one falls back to a list grouped by folder.
   */
  sidebar?: WikiNavSection[] | null;
  /**
   * Why there is no wiki. Distinguishes the cases the panel words differently:
   * no `origin` remote, a remote whose wiki does not exist, and a wiki the
   * Kabmo could not reach.
   */
  reason?: WikiUnavailableReason;
  /** Human-readable detail for `reason` (git's own message, trimmed). */
  detail?: string;
  generatedAt: string;
  isMock: boolean;
}

export type WikiUnavailableReason =
  /** The scoped directory is not a git checkout, or has no remote to read. */
  | 'no-remote'
  /** The remote URL is not one a wiki can be derived from. */
  | 'unsupported-remote'
  /** `<remote>.wiki.git` does not exist, or is not readable without a credential. */
  | 'no-wiki'
  /** The fetch failed for another reason (network, timeout, git missing). */
  | 'unreachable';

/** Wire payload of `GET /api/wiki/page`. */
export interface WikiPagePayload {
  /** Path as stored in the wiki repository. */
  path: string;
  /** Markdown source, verbatim. */
  content: string;
  /** True when the page was longer than the read budget and was cut. */
  truncated: boolean;
  generatedAt: string;
}
