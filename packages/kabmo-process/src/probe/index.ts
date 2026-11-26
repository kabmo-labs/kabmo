/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which process probe answers on this platform.
 *
 * The choice is by `process.platform`, at module load: macOS gets `libproc`,
 * Linux gets `/proc`, Windows gets the liveness-only probe, and anything else
 * (the BSDs) falls back to `ps`. No caller knows which one it got.
 *
 * macOS and Linux are the native paths because they are the platforms the
 * Kabmo actually runs on and where a subprocess-free answer exists; the `ps`
 * fallback stays for the platforms that have no other option.
 */

import type { ProcessProbe } from './types';
import { darwinProbe } from './darwin';
import { linuxProbe } from './linux';
import { psProbe } from './ps';
import { win32Probe } from './win32';

function selectProbe(): ProcessProbe {
  switch (process.platform) {
    case 'darwin':
      return darwinProbe;
    case 'linux':
      return linuxProbe;
    case 'win32':
      return win32Probe;
    default:
      return psProbe;
  }
}

/** The probe for the running platform. */
export const processProbe: ProcessProbe = selectProbe();

export { darwinProbe } from './darwin';
export { linuxProbe } from './linux';
export { psProbe } from './ps';
export { win32Probe } from './win32';
export type { ProcessLiveness, ProcessProbe } from './types';
