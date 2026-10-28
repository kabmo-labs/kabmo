/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone editor's prop contract.
 *
 * Split out of `FullEditor.tsx` for the repository's per-file ceiling, and it belongs
 * here for the same reason the desktop panel's does: the drawer and its tests name these,
 * and a prop type imported from the component module couples them to the mount.
 */

import type { MobileEditorFile } from '@/client/components/mobile/open-file-payload';

export interface MobileFullEditorProps {
  file: MobileEditorFile;
  onClose: () => void;
  /** The file this editor names is gone from disk. */
  missing?: boolean;
  /** Fired after a debounced write lands, so the workspace panels can refresh. */
  onFileSaved?: () => void;
  /** The outcome of a file dropped on this editor, for the host's toast stack. */
  onDropResult?: (result: { ok: boolean; message: string }) => void;
}
