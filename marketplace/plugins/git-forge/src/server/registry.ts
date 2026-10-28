/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One table from a provider to the module that speaks it.
 *
 * A lookup rather than a chain of `if`s at each call site: the server half has
 * three verbs (list, detail, and a write that re-reads the detail) and four
 * hosts, and twelve branches is twelve places a new host is forgotten. The table
 * is also what makes a host addable as ONE row plus its module — which is how
 * Gitea and Bitbucket were added.
 */

import type { ForgeDetail, ForgeList, ForgeProvider, ForgeSection } from '../protocol';
import type { ForgeContext } from './context';
import { detailBitbucket, listBitbucket } from './bitbucket';
import { detailGitea, listGitea } from './gitea';
import { detailGithub, listGithub } from './github';
import { listGitlab } from './gitlab';
import { detailGitlab } from './gitlab-detail';

/** What every adapter provides. */
export interface ForgeAdapter {
  list(context: ForgeContext): Promise<ForgeList>;
  detail(context: ForgeContext, section: ForgeSection, id: string): Promise<ForgeDetail | { error: string }>;
}

/**
 * The adapters, by provider.
 *
 * `Record<ForgeProvider, …>` rather than a partial map: adding a provider to the
 * union without adding its row is a compile error, which is the only thing that
 * keeps the four hosts in step.
 */
export const ADAPTERS: Record<ForgeProvider, ForgeAdapter> = {
  github: { list: listGithub, detail: detailGithub },
  gitlab: { list: listGitlab, detail: detailGitlab },
  gitea: { list: listGitea, detail: detailGitea },
  bitbucket: { list: listBitbucket, detail: detailBitbucket },
};

/** The adapter for one provider. */
export function adapterFor(provider: ForgeProvider): ForgeAdapter {
  return ADAPTERS[provider];
}
