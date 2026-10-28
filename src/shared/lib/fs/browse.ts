/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `/api/fs/browse` — the directory listing behind the New Workspace modal and
 * the folder picker.
 *
 * One module for both, because the two surfaces render the SAME listing and a
 * second copy of the response shape is how they drift: the picker's local
 * `DirectoryEntry` and the modal's would be structurally identical and
 * independently maintained.
 *
 * The response's `path` is the server's own resolution of what was asked for
 * (`~` expanded, made absolute), and callers are expected to adopt it — that
 * is what keeps a path field and the listing it describes naming the same
 * directory.
 */

export interface DirectoryEntry {
  name: string;
  path: string;
}

export interface BrowseResponse {
  /** The resolved directory the listing came from. */
  path?: string;
  /** The parent directory, or null at the browse root (the OS home). */
  parentPath?: string | null;
  directories?: DirectoryEntry[];
  error?: string;
  code?: string;
}

/** Read one directory's subfolders. Omitting `path` starts at the OS home. */
export async function fetchDirectories(path?: string): Promise<BrowseResponse> {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  const res = await fetch(`/api/fs/browse${query}`);
  const data = (await res.json()) as BrowseResponse;
  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}
