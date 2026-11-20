/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `HeaderControls` with the plugin entries its surface resolves.
 *
 * The cluster takes `entries` from its caller (the row and the visibility menu
 * are two halves of one `useHeaderEntries` answer), so a suite that mounts the
 * cluster on its own has to stand in for that caller. This harness is the
 * caller, not a second contract: it renders the real component with the real
 * hook against the suite's realtime server and plugin registry.
 */

import { h } from 'preact';
import { HeaderControls, type HeaderControlsProps } from '@/client/components/common/header-controls';
import { useHeaderEntries } from '@/client/components/common/header-panel-buttons/entries';

export function HeaderControlsHarness(props: Omit<HeaderControlsProps, 'entries'>) {
  return h(HeaderControls, { ...props, entries: useHeaderEntries(props.layout) });
}
