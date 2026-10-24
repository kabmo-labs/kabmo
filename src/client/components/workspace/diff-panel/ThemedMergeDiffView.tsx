/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `MergeDiffView` with the editor theme applied.
 *
 * A wrapper rather than a prop at the call site because the diff panel and the
 * chat's diff card are the same surface: both must wear the editor theme the
 * user picked, and the panel's own file is at the size ceiling. Keeping the
 * subscription here means the theme reaches every diff with no second
 * `useEditorTheme` call to keep in step.
 */

import { MergeDiffView } from '@/client/components/workspace/diff-panel/MergeDiffView';
import { useEditorTheme } from '@/client/hooks/editor/theme';

type MergeDiffViewProps = Parameters<typeof MergeDiffView>[0];

export function ThemedMergeDiffView(props: MergeDiffViewProps) {
  const editorTheme = useEditorTheme();
  return <MergeDiffView {...props} themeVars={editorTheme.vars} themes={editorTheme.themes} />;
}
