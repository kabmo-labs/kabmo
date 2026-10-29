/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The payloads the two panel suites mount, in one place.
 *
 * Shared rather than copied because both suites assert against the SAME shapes
 * the server sends: a fixture that drifted would let one suite pass while
 * describing a payload the panel never receives, and a new field on
 * `ForgeSectionData` or `ForgeCapabilities` is two places to forget.
 *
 * `failed` is spelled out on every section even where it is `false`: it is the
 * flag that separates "nothing here" from "could not be read", and a fixture
 * that omits it makes the panel's two empty states indistinguishable.
 */

import {
  readOnly,
  type ForgeDetail,
  type ForgeItem,
  type ForgeList,
  type ForgeSectionData,
} from '../protocol';

/** One row, with the fields a row draws. */
export function item(overrides: Partial<ForgeItem> = {}): ForgeItem {
  return {
    id: '1',
    number: 1,
    title: 'Something is broken',
    state: 'open',
    author: 'ana',
    updatedAt: new Date().toISOString(),
    url: 'https://example/1',
    labels: [],
    comments: 0,
    tag: null,
    ...overrides,
  };
}

/** One section's payload. */
export function section(overrides: Partial<ForgeSectionData> = {}): ForgeSectionData {
  return { items: [], truncated: false, total: 0, failed: false, ...overrides };
}

/** One list read: an open issue, one change, no releases. */
export function list(overrides: Partial<ForgeList> = {}): ForgeList {
  return {
    provider: 'github',
    host: 'github.com',
    slug: 'kabmo-labs/kabmo',
    webUrl: 'https://github.com/kabmo-labs/kabmo',
    filter: { state: 'open', mine: false, label: '', query: '' },
    sections: {
      issues: section({ items: [item()], total: 1 }),
      pulls: section({ items: [item({ id: '2', number: 2, title: 'A change' })], total: 1 }),
      releases: section({ total: null }),
    },
    notes: [],
    ...overrides,
  };
}

/** One detail read: the item, a body and, when asked, one reply. */
export function detail(overrides: Partial<ForgeDetail> = {}): ForgeDetail {
  return {
    item: item(),
    body: 'The **body** text.',
    comments: [],
    facts: [],
    files: [],
    commits: [],
    ci: null,
    capabilities: { ...readOnly(), comment: true, state: true },
    notes: [],
    ...overrides,
  };
}
