/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Archive names, formats and destinations — the facts BOTH ends need.
 *
 * The Files panel decides which menu rows to offer (Extract only on an archive,
 * Compress on any selection) and which name a new archive should take; the
 * server decides which binary runs and refuses what cannot be written. Keeping
 * the suffix table, the format list and the default names in one module is what
 * stops the dialog from offering `.zip` while the route expects `.7z`.
 *
 * The compress list is intentionally shorter than the extract list: extracting
 * a `.rar` only needs a reader, while creating one needs the proprietary `rar`
 * binary, which most machines do not ship. The dialog reports the formats the
 * server can actually run.
 */

/** A format the Compress dialog can write. */
export type ArchiveFormat = 'zip' | '7z' | 'rar' | 'tar' | 'tar.gz';

/** Every archive spelling the Extract menu recognises. */
export type ArchiveKind =
  | 'zip'
  | '7z'
  | 'rar'
  | 'tar'
  | 'tar.gz'
  | 'tar.bz2'
  | 'tar.xz'
  | 'gz'
  | 'bz2'
  | 'xz';

export interface ArchiveFormatInfo {
  id: ArchiveFormat;
  /** What the dialog shows. */
  label: string;
  /** The suffix the default name takes, without a dot. */
  extension: string;
}

export const COMPRESS_FORMATS: readonly ArchiveFormatInfo[] = [
  { id: 'zip', label: 'ZIP', extension: 'zip' },
  { id: '7z', label: '7Z', extension: '7z' },
  { id: 'rar', label: 'RAR', extension: 'rar' },
  { id: 'tar', label: 'TAR', extension: 'tar' },
  { id: 'tar.gz', label: 'TAR.GZ', extension: 'tar.gz' },
];

/** Suffix → kind, longest first so `.tar.gz` is not read as `.gz`. */
const KIND_SUFFIXES: ReadonlyArray<readonly [string, ArchiveKind]> = [
  ['.tar.gz', 'tar.gz'],
  ['.tar.bz2', 'tar.bz2'],
  ['.tar.xz', 'tar.xz'],
  ['.tgz', 'tar.gz'],
  ['.tbz2', 'tar.bz2'],
  ['.txz', 'tar.xz'],
  ['.tar', 'tar'],
  ['.zip', 'zip'],
  ['.7z', '7z'],
  ['.rar', 'rar'],
  ['.gz', 'gz'],
  ['.bz2', 'bz2'],
  ['.xz', 'xz'],
];

/** The archive kind `name` is spelled as, or null when it is not one. */
export function archiveKindOf(name: string): ArchiveKind | null {
  const lower = name.toLowerCase();
  for (const [suffix, kind] of KIND_SUFFIXES) {
    if (lower.endsWith(suffix)) return kind;
  }
  return null;
}

/** Whether a row is an archive the panel can offer Extract for. */
export function isArchiveName(name: string): boolean {
  return archiveKindOf(name) !== null;
}

/** The format entry for an id, or undefined for an unknown id. */
export function archiveFormatInfo(format: string): ArchiveFormatInfo | undefined {
  return COMPRESS_FORMATS.find((entry) => entry.id === format);
}

/** The extension a format's file name ends with, without the dot. */
export function archiveExtension(format: ArchiveFormat): string {
  return archiveFormatInfo(format)?.extension ?? 'zip';
}

/** The name with any recognised archive suffix removed (`a.tar.gz` → `a`). */
export function stripArchiveSuffix(name: string): string {
  const lower = name.toLowerCase();
  for (const [suffix] of KIND_SUFFIXES) {
    if (lower.endsWith(suffix)) return name.slice(0, -suffix.length);
  }
  return name;
}

/** The folder part of a relative POSIX path, `.` at the top. */
export function parentDirOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '.' : path.slice(0, cut) || '.';
}

/** The last segment of a relative POSIX path. */
export function baseNameOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}

/**
 * The deepest folder that contains every path.
 *
 * A compress runs with that folder as its working directory, so every argument
 * is a clean relative name rather than a `../` climb — which is also the rule
 * the server enforces. Paths from different branches therefore share `.` and
 * the archive sits at the listing root.
 */
export function commonParentDir(paths: readonly string[]): string {
  if (paths.length === 0) return '.';
  const split = paths.map((path) => parentDirOf(path).split('/').filter((segment) => segment !== '.'));
  let shared = split[0] ?? [];
  for (const segments of split.slice(1)) {
    let index = 0;
    while (index < shared.length && index < segments.length && shared[index] === segments[index]) index += 1;
    shared = shared.slice(0, index);
  }
  return shared.length === 0 ? '.' : shared.join('/');
}

export interface ArchiveNameSource {
  path: string;
  name: string;
  kind: 'file' | 'folder';
}

/**
 * The name a Compress dialog proposes.
 *
 * One file keeps its stem (`report.pdf` → `report.zip`), one folder its own
 * name (`src` → `src.zip`), and a multi-selection takes the name of the folder
 * they live in — naming the archive after the first arbitrary file would hide
 * what it holds.
 */
export function defaultArchiveName(entries: readonly ArchiveNameSource[], format: ArchiveFormat): string {
  const extension = archiveExtension(format);
  if (entries.length === 1) {
    const entry = entries[0]!;
    // A file's own extension is dropped too: `report.pdf` compresses to
    // `report.zip`, not `report.pdf.zip`, which reads as an archive of a PDF
    // renamed twice.
    const withoutArchive = stripArchiveSuffix(entry.name);
    const dot = withoutArchive.lastIndexOf('.');
    const stem = entry.kind === 'folder'
      ? entry.name
      : dot > 0 ? withoutArchive.slice(0, dot) : withoutArchive;
    return `${stem || 'archive'}.${extension}`;
  }
  const common = commonParentDir(entries.map((entry) => entry.path));
  const folder = baseNameOf(common);
  return `${folder === '.' || folder === '' ? 'archive' : folder}.${extension}`;
}

/**
 * The destination a Compress dialog proposes: the folder the selection lives
 * in, which is where the archive appears beside it.
 */
export function defaultArchiveDestination(entries: readonly ArchiveNameSource[]): string {
  return commonParentDir(entries.map((entry) => entry.path));
}

/**
 * The folder an Extract dialog proposes: a sibling of the archive named after
 * its stem (`src.zip` → `src`). Extracting in place is the same call with `.`
 * typed in the field, so the default never scatters files beside the archive.
 */
export function defaultExtractDestination(archivePath: string): string {
  const parent = parentDirOf(archivePath);
  const stem = stripArchiveSuffix(baseNameOf(archivePath));
  if (!stem) return parent;
  return parent === '.' ? stem : `${parent}/${stem}`;
}

/** The display name of an archive kind, for the dialog's subtitle. */
export function archiveKindLabel(kind: ArchiveKind): string {
  return kind.toUpperCase();
}
