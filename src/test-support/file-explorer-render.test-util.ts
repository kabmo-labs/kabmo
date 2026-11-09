/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Draw the Files panel into a container, with an explicit `active` flag.
 *
 * Split from the harness so a spec can change the panel's visibility WITHOUT a
 * remount: the desktop layout keeps a hidden view mounted and hides it with
 * CSS, and only a re-render with another `active` reproduces that. Kept in its
 * own module so the harness stays under the repository's line ceiling.
 */

import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { FileExplorer } from '@/client/components/workspace/file-explorer/index';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';

export async function renderFileExplorer(
  container: HTMLElement,
  sessionId: string,
  rootPath: string,
  active: boolean,
  onOpenFile: (file: { path: string; name: string }) => void,
): Promise<void> {
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId,
        children: h(FileExplorer, { rootPath, enabled: true, active, onOpenFile }),
      }),
      container,
    );
  });
  for (let i = 0; i < 10; i += 1) await act(async () => {});
}
