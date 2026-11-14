/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'preact/hooks';
import { setCommandContext } from '@/client/lib/commands/context';

/**
 * Publish one context key for as long as the calling component is mounted.
 *
 * The cleanup writes `undefined` rather than `false`: a key nobody publishes
 * must read as absent, so a `when` clause naming it is false instead of
 * accidentally true.
 */
export function useCommandContext(key: string, value: boolean | string | number | undefined): void {
  useEffect(() => {
    setCommandContext(key, value);
    return () => setCommandContext(key, undefined);
  }, [key, value]);
}
