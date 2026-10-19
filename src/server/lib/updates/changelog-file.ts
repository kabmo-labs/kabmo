/**
 * The release notes behind the "What's new" popup, read from the repository's
 * own `CHANGELOG.md`.
 *
 * That file IS the release notes: `release.config.mjs` writes each
 * `## [x.y.z] — YYYY-MM-DD` section from the Conventional Commits of the release
 * and posts the same prose as the GitHub release body, so reading the file gives
 * the identical text without asking the Releases API for it — no 60-per-hour
 * unauthenticated limit, no `GITHUB_TOKEN`, and no dependency on the release
 * pipeline having created a release object for the tag.
 *
 * Sections are parsed by heading, so the popup's range is decided by the versions
 * the changelog itself names: newest first, each with its date and body. The
 * heading's own compare link is dropped rather than rendered — the popup draws
 * the heading itself and links each section to that version's release page.
 */

import { releaseTagUrl, REPO } from '@/server/lib/updates/release-url';
import type { ReleaseNote } from '@/shared/types/updates';

/**
 * The changelog as served, on the branch the releases are cut from.
 *
 * The VERSION range comes from npm (see ./npm) — that is the channel an install
 * moves to. The NOTES come from this file, and each section links to that
 * version's GitHub release page, which is where the same prose is published for
 * a reader to follow.
 */
export const CHANGELOG_URL = `https://raw.githubusercontent.com/${REPO}/HEAD/CHANGELOG.md`;

/** How long a read is reused. The file changes on release, not on read. */
const TTL_MS = 60_000;

/** A hung CDN must not hold the popup open. */
const TIMEOUT_MS = 10_000;

/**
 * A release heading, in both spellings the file carries:
 *
 *     ## [3.14.0](https://…/compare/v3.13.1...v3.14.0) — 2026-10-04
 *     ## [0.5.0] — 2026-09-21
 *
 * The `### Added` subheadings below it do not match, and neither does the
 * `[0.5.0]: https://…` reference block at the file's tail.
 */
const SECTION_HEADING = /^##\s+\[?v?(\d[\w.-]*)\]?(?:\([^)]*\))?\s*(?:[—–-]\s*(\d{4}-\d{2}-\d{2}))?\s*$/;

/** `[0.5.0]: https://…` — the link definitions the changelog ends with. */
const REFERENCE_DEFINITION = /^\[[^\]]+\]:\s/;

/**
 * Every release section in the file, newest first (file order). A heading whose
 * body is empty is kept — a version that shipped without notes is still a
 * version, and the popup words the empty case.
 *
 * The parse STOPS at the trailing reference block: those lines are link
 * definitions, not notes, and without the guard they rendered as the last
 * section's body.
 */
export function parseChangelogSections(markdown: string): ReleaseNote[] {
  const notes: ReleaseNote[] = [];
  let version: string | null = null;
  let date: string | null = null;
  let body: string[] = [];

  const flush = () => {
    if (version === null) return;
    notes.push({ version, date, url: releaseTagUrl(version), body: body.join('\n').trim() });
  };

  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();
    if (REFERENCE_DEFINITION.test(line.trim())) {
      flush();
      version = null;
      body = [];
      continue;
    }
    if (line.startsWith('## ')) {
      flush();
      const match = SECTION_HEADING.exec(line.trim());
      version = match?.[1] ?? null;
      date = match?.[2] ?? null;
      body = [];
      continue;
    }
    if (version !== null) body.push(line);
  }
  flush();

  return notes;
}

/** The parsed sections, cached on `globalThis` for the same reason the database is. */
interface ChangelogCache {
  notes: ReleaseNote[];
  at: number;
}

const cacheSlot = globalThis as typeof globalThis & { __ompChamberChangelogCache?: ChangelogCache };

/** Never throws: an unreadable changelog is an empty list, and the caller words it. */
export async function fetchChangelogNotes(force = false): Promise<ReleaseNote[]> {
  const cached = cacheSlot.__ompChamberChangelogCache;
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.notes;

  let notes: ReleaseNote[] = [];
  try {
    const response = await fetch(CHANGELOG_URL, {
      headers: { 'User-Agent': 'ompchamber' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) notes = parseChangelogSections(await response.text());
  } catch {
    // Reported as an empty list; the popup says the notes could not be fetched.
  }

  // An empty read is not cached: a transient failure would otherwise pin "no
  // release notes" for a minute and hide a real update.
  if (notes.length > 0) cacheSlot.__ompChamberChangelogCache = { notes, at: Date.now() };
  return notes;
}
