/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two writes the New Workspace dialog performs.
 *
 * Both sidebars (desktop and mobile) render the same dialog, so the request
 * shape lives here rather than twice at a call site: the body keys, the error
 * extraction and the reload after a successful write are one behaviour, and a
 * second copy is how the mobile dialog ends up sending a field the route does
 * not read.
 *
 * A reload is deliberate for both. Creating a workspace changes which folder a
 * session belongs to and which project every right panel is scoped to, and the
 * page's own layout state is resolved at boot — a realtime signal updates the
 * sidebar list but not the workspace-scoped reads already in flight.
 */

/** POST /api/folders — register a directory that already exists. */
export async function createWorkspaceFolder(input: { name: string; path?: string }): Promise<void> {
  const res = await fetch('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  window.location.reload();
}

/** POST /api/folders/clone — clone a repository and register it in one step. */
export async function cloneWorkspaceFolder(input: {
  url: string;
  parent: string;
  name?: string;
}): Promise<void> {
  const res = await fetch('/api/folders/clone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  window.location.reload();
}
