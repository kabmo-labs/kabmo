/**
 * "What's new" for the version that is running, per target.
 *
 * The update popup answers "what would I get" from the range between the
 * installed version and npm's newest one. The About modal's pair of buttons
 * answers the other question — "what am I running" — so this module reads the
 * installed version from the machine (package.json on disk for Kabmo,
 * `omp --version` for oh-my-pi) and takes exactly that version's changelog
 * section. Nothing here trusts a client-supplied version: a caller cannot ask
 * for notes belonging to a release this install never had.
 *
 * Never throws. A missing section, an unreadable install and an unreachable
 * changelog are all `error` fields, because the dialog opens from a button and a
 * 500 would surface as an empty panel with no explanation.
 */

import { fetchChangelogNotes, fetchOmpChangelogNotes } from '@/server/lib/updates/changelog-file';
import { readInstalledVersion } from '@/server/lib/updates/install';
import { readOmpInstalledVersion } from '@/server/lib/updates/omp';
import { CHANGELOG_PAGE, OMP_CHANGELOG_PAGE } from '@/server/lib/updates/release-url';
import { normalizeVersion } from '@/shared/lib/updates/semver';
import type { ActiveReleaseNotes, ReleaseNote, UpdateTarget } from '@/shared/types/updates';

/**
 * The section belonging to `version`, matched on normalized semver so a
 * changelog heading's `v` prefix and the binary's bare version agree.
 */
export function selectActiveNote(notes: ReleaseNote[], version: string | null): ReleaseNote | null {
  const wanted = version ? normalizeVersion(version) : null;
  if (!wanted) return null;
  return notes.find((note) => normalizeVersion(note.version) === wanted) ?? null;
}

/** The notes for one target's running version. */
export async function buildActiveReleaseNotes(target: UpdateTarget): Promise<ActiveReleaseNotes> {
  const changelogUrl = target === 'omp' ? OMP_CHANGELOG_PAGE : CHANGELOG_PAGE;

  try {
    const probe = target === 'omp' ? await readOmpInstalledVersion() : null;
    const version = probe ? probe.current : await readInstalledVersion();
    if (!version) {
      return {
        target,
        version: null,
        note: null,
        changelogUrl,
        error: probe
          ? probe.error ?? 'Could not determine the installed omp version'
          : 'The installed Kabmo version could not be read',
      };
    }

    const notes = target === 'omp' ? await fetchOmpChangelogNotes() : await fetchChangelogNotes();
    if (notes.length === 0) {
      return { target, version, note: null, changelogUrl, error: 'Release notes could not be fetched' };
    }

    const note = selectActiveNote(notes, version);
    return {
      target,
      version,
      note,
      changelogUrl,
      error: note ? null : `No changelog section for v${version}`,
    };
  } catch (error) {
    return {
      target,
      version: null,
      note: null,
      changelogUrl,
      error: error instanceof Error ? error.message : 'Release notes could not be read',
    };
  }
}